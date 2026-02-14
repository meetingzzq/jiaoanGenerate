"""
API服务器 - 提供前端调用的接口
"""
import os
import json
import sys
import io
import queue
import threading
import time
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory, Response, stream_with_context
from flask_cors import CORS

RENDER_DATA_DIR = os.environ.get('RENDER_DATA_DIR', '')

def get_resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath('.'), relative_path)

def get_base_dir():
    if hasattr(sys, '_MEIPASS'):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = get_base_dir()
sys.path.insert(0, BASE_DIR)

from main import batch_generate_lesson_plans, generate_lesson_plan_doc
from config import DEFAULT_FIXED_COURSE_INFO
from document_processor import extract_document_content, get_document_summary

DATA_DIR = RENDER_DATA_DIR if RENDER_DATA_DIR else BASE_DIR

UPLOAD_DIR = os.path.join(DATA_DIR, 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)

uploaded_documents = {}

app = Flask(__name__)
CORS(app)

STATIC_DIR = os.path.join(BASE_DIR, 'frontend', 'dist')
OUTPUT_DIR = os.path.join(DATA_DIR, 'output')

os.makedirs(OUTPUT_DIR, exist_ok=True)

log_queues = {}
log_queues_lock = threading.Lock()

generation_sessions = {}
sessions_lock = threading.Lock()

class LogCapture:
    def __init__(self, session_id):
        self.session_id = session_id
        self.original_stdout = sys.stdout
        self.log_buffer = []
        
    def write(self, message):
        self.original_stdout.write(message)
        self.original_stdout.flush()
        
        if message.strip():
            with log_queues_lock:
                if self.session_id in log_queues:
                    log_queues[self.session_id].put({
                        'time': time.strftime('%H:%M:%S'),
                        'message': message.strip()
                    })
    
    def flush(self):
        self.original_stdout.flush()


def get_log_queue(session_id):
    with log_queues_lock:
        if session_id not in log_queues:
            log_queues[session_id] = queue.Queue()
        return log_queues[session_id]


def clear_log_queue(session_id):
    with log_queues_lock:
        if session_id in log_queues:
            while not log_queues[session_id].empty():
                try:
                    log_queues[session_id].get_nowait()
                except queue.Empty:
                    break


def update_session(session_id, data):
    with sessions_lock:
        if session_id not in generation_sessions:
            generation_sessions[session_id] = {
                'created_at': datetime.now().isoformat(),
                'status': 'pending',
                'progress': 0,
                'results': [],
                'logs': []
            }
        generation_sessions[session_id].update(data)
        generation_sessions[session_id]['updated_at'] = datetime.now().isoformat()


def get_session(session_id):
    with sessions_lock:
        return generation_sessions.get(session_id)


def add_log_to_session(session_id, log_entry):
    with sessions_lock:
        if session_id in generation_sessions:
            generation_sessions[session_id]['logs'].append(log_entry)


@app.route('/api/session', methods=['POST'])
def create_session():
    session_id = str(uuid.uuid4())
    update_session(session_id, {'status': 'ready'})
    return jsonify({'success': True, 'session_id': session_id})


@app.route('/api/session/<session_id>', methods=['GET'])
def get_session_status(session_id):
    session = get_session(session_id)
    if not session:
        return jsonify({'success': False, 'message': '会话不存在'}), 404
    
    with log_queues_lock:
        log_queue = log_queues.get(session_id)
        new_logs = []
        if log_queue:
            while not log_queue.empty():
                try:
                    new_logs.append(log_queue.get_nowait())
                except queue.Empty:
                    break
    
    if new_logs:
        add_log_to_session(session_id, new_logs)
    
    return jsonify({
        'success': True,
        'session': session
    })


@app.route('/api/logs/<session_id>/poll')
def poll_logs(session_id):
    last_index = int(request.args.get('last_index', 0))
    session = get_session(session_id)
    
    if not session:
        return jsonify({'success': False, 'message': '会话不存在'}), 404
    
    with log_queues_lock:
        log_queue = log_queues.get(session_id)
        new_logs = []
        if log_queue:
            while not log_queue.empty():
                try:
                    new_logs.append(log_queue.get_nowait())
                except queue.Empty:
                    break
    
    if new_logs:
        add_log_to_session(session_id, new_logs)
    
    all_logs = session.get('logs', [])
    logs_to_return = all_logs[last_index:]
    
    return jsonify({
        'success': True,
        'logs': logs_to_return,
        'total_logs': len(all_logs),
        'status': session.get('status'),
        'progress': session.get('progress', 0),
        'results': session.get('results', [])
    })


@app.route('/api/logs/<session_id>')
def stream_logs(session_id):
    def generate():
        log_queue = get_log_queue(session_id)
        yield f"data: {json.dumps({'type': 'connected', 'message': '日志连接已建立'})}\n\n"
        
        try:
            while True:
                try:
                    log_entry = log_queue.get(timeout=1)
                    yield f"data: {json.dumps({'type': 'log', 'data': log_entry})}\n\n"
                except queue.Empty:
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                    continue
        except GeneratorExit:
            pass
    
    return Response(
        stream_with_context(generate()),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'
        }
    )


@app.route('/api/generate', methods=['POST'])
def generate():
    session_id = request.headers.get('X-Session-ID', request.json.get('session_id', 'default'))
    
    clear_log_queue(session_id)
    update_session(session_id, {
        'status': 'generating',
        'progress': 0,
        'results': [],
        'logs': []
    })
    
    log_capture = LogCapture(session_id)
    old_stdout = sys.stdout
    sys.stdout = log_capture
    
    try:
        data = request.json
        if not data:
            update_session(session_id, {'status': 'error', 'error': '请提供生成参数'})
            return jsonify({'success': False, 'message': '请提供生成参数'}), 400

        fixed_course_info = data.get('fixed_course_info', {})
        variable_course_info = data.get('variable_course_info', {})
        lesson_index = data.get('lesson_index', 1)
        api_key = data.get('api_key', '')

        if not variable_course_info:
            update_session(session_id, {'status': 'error', 'error': '请提供课时信息'})
            return jsonify({'success': False, 'message': '请提供课时信息'}), 400

        if not api_key or api_key.strip() == '':
            update_session(session_id, {'status': 'error', 'error_type': 'missing_api_key'})
            return jsonify({
                'success': False,
                'error_type': 'missing_api_key',
                'message': '未提供DeepSeek API Key，请输入您的API Key'
            }), 400
        
        os.environ['DEEPSEEK_API_KEY'] = api_key
        print(f"使用用户提供的DeepSeek API Key: {api_key[:10]}...")

        complete_fixed_info = {**DEFAULT_FIXED_COURSE_INFO, **fixed_course_info}
        course_info = {**complete_fixed_info, **variable_course_info}
        
        lesson_id = str(lesson_index)
        docs = uploaded_documents.get(lesson_id, [])
        if docs:
            course_info['参考文档'] = [
                {'filename': doc.get('filename', '未命名文档'), 'content': doc.get('content', '')}
                for doc in docs
            ]
            print(f"已关联 {len(docs)} 个参考文档")

        topic = course_info.get('课题名称', f'课时{lesson_index}')
        safe_topic = topic.replace('\\', '-').replace('/', '-').replace(':', '-').replace('*', '-').replace('?', '-').replace('"', '-').replace('<', '-').replace('>', '-').replace('|', '-')
        file_name = f"{lesson_index:02d}_{safe_topic}.docx"
        output_path = os.path.join(OUTPUT_DIR, file_name)

        update_session(session_id, {'progress': 20, 'current_topic': topic})

        template_path = os.path.join(BASE_DIR, 'moban.docx')
        success = generate_lesson_plan_doc(
            template_path=template_path,
            output_path=output_path,
            course_info=course_info,
            use_mock=False
        )

        if success == "invalid_api_key":
            update_session(session_id, {'status': 'error', 'error_type': 'invalid_api_key'})
            return jsonify({
                'success': False,
                'error_type': 'invalid_api_key',
                'message': 'DeepSeek API Key无效或已过期'
            }), 401

        update_session(session_id, {'progress': 100})

        if success and os.path.exists(output_path):
            result = {
                'topic': topic,
                'status': '成功',
                'file_name': file_name,
                'file_url': f'/download/{file_name}'
            }
            update_session(session_id, {'status': 'completed', 'results': [result]})
            return jsonify({'success': True, 'result': result})
        else:
            update_session(session_id, {'status': 'error', 'error': '文件未生成'})
            return jsonify({'success': False, 'message': '文件未生成'})

    except Exception as e:
        update_session(session_id, {'status': 'error', 'error': str(e)})
        return jsonify({'success': False, 'message': f'生成失败: {str(e)}'}), 500
    finally:
        sys.stdout = old_stdout


@app.route('/api/batch-generate', methods=['POST'])
def batch_generate():
    session_id = request.headers.get('X-Session-ID', request.json.get('session_id', 'default'))
    
    clear_log_queue(session_id)
    update_session(session_id, {
        'status': 'generating',
        'progress': 0,
        'results': [],
        'logs': [],
        'total_lessons': 0,
        'current_lesson': 0
    })
    
    log_capture = LogCapture(session_id)
    old_stdout = sys.stdout
    sys.stdout = log_capture
    
    try:
        data = request.json
        if not data:
            update_session(session_id, {'status': 'error', 'error': '请提供生成参数'})
            return jsonify({'success': False, 'message': '请提供生成参数'}), 400

        fixed_course_info = data.get('fixed_course_info', {})
        variable_course_infos = data.get('variable_course_infos', [])
        api_key = data.get('api_key', '')

        if not variable_course_infos:
            update_session(session_id, {'status': 'error', 'error': '请至少提供一个课时信息'})
            return jsonify({'success': False, 'message': '请至少提供一个课时信息'}), 400

        if not api_key or api_key.strip() == '':
            update_session(session_id, {'status': 'error', 'error_type': 'missing_api_key'})
            return jsonify({
                'success': False,
                'error_type': 'missing_api_key',
                'message': '未提供DeepSeek API Key'
            }), 400
        
        os.environ['DEEPSEEK_API_KEY'] = api_key
        print("使用用户提供的DeepSeek API Key")

        complete_fixed_info = {**DEFAULT_FIXED_COURSE_INFO, **fixed_course_info}
        
        total_lessons = len(variable_course_infos)
        update_session(session_id, {'total_lessons': total_lessons})
        
        results = []
        
        for i, lesson in enumerate(variable_course_infos, 1):
            lesson_id = str(lesson.get('id', ''))
            if lesson_id and lesson_id in uploaded_documents:
                docs = uploaded_documents[lesson_id]
                if docs:
                    lesson['参考文档'] = [
                        {'filename': doc['filename'], 'content': doc['content']}
                        for doc in docs
                    ]
                    print(f"课时 {lesson_id}: 已关联 {len(docs)} 个参考文档")
            
            progress = int((i / total_lessons) * 100)
            topic = lesson.get('课题名称', f'课时{i}')
            update_session(session_id, {
                'current_lesson': i,
                'current_topic': topic,
                'progress': progress
            })
            
            safe_topic = topic.replace('\\', '-').replace('/', '-').replace(':', '-').replace('*', '-').replace('?', '-').replace('"', '-').replace('<', '-').replace('>', '-').replace('|', '-')
            file_name = f"{i:02d}_{safe_topic}.docx"
            output_path = os.path.join(OUTPUT_DIR, file_name)
            
            course_info = {**complete_fixed_info, **lesson}
            
            template_path = os.path.join(BASE_DIR, 'moban.docx')
            success = generate_lesson_plan_doc(
                template_path=template_path,
                output_path=output_path,
                course_info=course_info,
                use_mock=False
            )
            
            if success and os.path.exists(output_path):
                results.append({
                    'topic': topic,
                    'status': '成功',
                    'file_name': file_name,
                    'file_url': f'/download/{file_name}'
                })
            else:
                results.append({
                    'topic': topic,
                    'status': '失败',
                    'message': '文件未生成'
                })
            
            update_session(session_id, {'results': results})
        
        update_session(session_id, {
            'status': 'completed',
            'progress': 100,
            'results': results
        })
        
        return jsonify({'success': True, 'results': results})

    except Exception as e:
        update_session(session_id, {'status': 'error', 'error': str(e)})
        return jsonify({'success': False, 'message': f'生成失败: {str(e)}'}), 500
    finally:
        sys.stdout = old_stdout


@app.route('/api/upload-document', methods=['POST'])
def upload_document():
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'message': '没有上传文件'}), 400
        
        file = request.files['file']
        lesson_id = request.form.get('lesson_id', '')
        
        if file.filename == '':
            return jsonify({'success': False, 'message': '文件名为空'}), 400
        
        allowed_extensions = {'.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.txt', '.pdf'}
        file_ext = os.path.splitext(file.filename)[1].lower()
        
        if file_ext not in allowed_extensions:
            return jsonify({'success': False, 'message': f'不支持的文件格式: {file_ext}'}), 400
        
        safe_filename = f"{lesson_id}_{int(time.time())}_{file.filename}"
        file_path = os.path.join(UPLOAD_DIR, safe_filename)
        
        file.save(file_path)
        
        import gc
        gc.collect()
        
        time.sleep(0.1)
        
        print(f"文档已上传到: {file_path}")
        print(f"UPLOAD_DIR: {UPLOAD_DIR}")
        print(f"文件是否存在: {os.path.exists(file_path)}")
        if os.path.exists(file_path):
            print(f"文件大小: {os.path.getsize(file_path)}")
        
        if not os.path.exists(file_path):
            return jsonify({'success': False, 'message': '文件保存失败'}), 500
        
        content = extract_document_content(file_path)
        
        if content is None:
            print(f"警告: 无法提取文档内容，但文件存在")
            content = ""
        
        content_summary = get_document_summary(file_path, max_length=500)
        
        doc_info = {
            'filename': file.filename,
            'filepath': file_path,
            'content': content,
            'content_summary': content_summary,
            'file_size': os.path.getsize(file_path),
            'upload_time': time.strftime('%Y-%m-%d %H:%M:%S')
        }
        
        if lesson_id not in uploaded_documents:
            uploaded_documents[lesson_id] = []
        uploaded_documents[lesson_id].append(doc_info)
        
        print(f"文档内容提取成功，字符数: {len(content)}")
        
        return jsonify({
            'success': True,
            'message': '文档上传成功',
            'document': {
                'filename': file.filename,
                'file_size': doc_info['file_size'],
                'content_summary': content_summary,
                'upload_time': doc_info['upload_time']
            }
        })
        
    except Exception as e:
        print(f"上传文档失败: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'message': f'上传失败: {str(e)}'}), 500


@app.route('/api/documents/<lesson_id>', methods=['GET'])
def get_documents(lesson_id):
    try:
        docs = uploaded_documents.get(lesson_id, [])
        return jsonify({
            'success': True,
            'documents': [
                {
                    'filename': doc['filename'],
                    'file_size': doc['file_size'],
                    'content_summary': doc['content_summary'],
                    'upload_time': doc['upload_time']
                }
                for doc in docs
            ]
        })
    except Exception as e:
        return jsonify({'success': False, 'message': f'获取文档列表失败: {str(e)}'}), 500


@app.route('/api/documents/<lesson_id>/<filename>', methods=['DELETE'])
def delete_document(lesson_id, filename):
    try:
        if lesson_id in uploaded_documents:
            docs = uploaded_documents[lesson_id]
            for i, doc in enumerate(docs):
                if doc['filename'] == filename:
                    if os.path.exists(doc['filepath']):
                        os.remove(doc['filepath'])
                    uploaded_documents[lesson_id].pop(i)
                    return jsonify({'success': True, 'message': '文档删除成功'})
        
        return jsonify({'success': False, 'message': '文档不存在'}), 404
        
    except Exception as e:
        return jsonify({'success': False, 'message': f'删除失败: {str(e)}'}), 500


@app.route('/download/<filename>', methods=['GET'])
def download_file(filename):
    try:
        return send_from_directory(OUTPUT_DIR, filename, as_attachment=True)
    except Exception as e:
        return jsonify({'success': False, 'message': f'下载失败: {str(e)}'}), 404


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    if path and os.path.exists(os.path.join(STATIC_DIR, path)):
        return send_from_directory(STATIC_DIR, path)
    else:
        return send_from_directory(STATIC_DIR, 'index.html')


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)
