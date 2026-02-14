"""
API服务器 - 提供前端调用的接口
"""
import os
import sys
import io
import json
import queue
import threading
import time
import uuid
import logging
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

SESSION_DIR = os.path.join(DATA_DIR, 'sessions')
os.makedirs(SESSION_DIR, exist_ok=True)

uploaded_documents = {}

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024

STATIC_DIR = os.path.join(BASE_DIR, 'frontend', 'dist')
OUTPUT_DIR = os.path.join(DATA_DIR, 'output')

os.makedirs(OUTPUT_DIR, exist_ok=True)



generation_sessions = {}
sessions_lock = threading.Lock()


def save_session_to_file(session_id, session_data):
    try:
        session_file = os.path.join(SESSION_DIR, f'{session_id}.json')
        with open(session_file, 'w', encoding='utf-8') as f:
            json.dump(session_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logging.error(f"保存会话文件失败: {e}")


def load_session_from_file(session_id):
    try:
        session_file = os.path.join(SESSION_DIR, f'{session_id}.json')
        if os.path.exists(session_file):
            with open(session_file, 'r', encoding='utf-8') as f:
                return json.load(f)
    except Exception as e:
        logging.error(f"加载会话文件失败: {e}")
    return None





def update_session(session_id, data):
    with sessions_lock:
        if session_id not in generation_sessions:
            generation_sessions[session_id] = {
                'created_at': datetime.now().isoformat(),
                'status': 'pending',
                'progress': 0,
                'results': []
            }
        generation_sessions[session_id].update(data)
        generation_sessions[session_id]['updated_at'] = datetime.now().isoformat()
        # 保存到文件
        save_session_to_file(session_id, generation_sessions[session_id])


def get_session(session_id):
    with sessions_lock:
        session = generation_sessions.get(session_id)
        if session:
            return session
        # 尝试从文件加载
        session = load_session_from_file(session_id)
        if session:
            generation_sessions[session_id] = session
        return session





@app.route('/api/session', methods=['POST'])
def create_session():
    session_id = str(uuid.uuid4())
    update_session(session_id, {'status': 'ready'})
    return jsonify({'success': True, 'session_id': session_id})


@app.route('/api/session/<session_id>', methods=['GET'])
def get_session_status(session_id):
    logging.debug(f"获取会话状态: {session_id}")
    session = get_session(session_id)
    logging.debug(f"会话数据: {session}")
    if not session:
        logging.debug(f"会话不存在")
        return jsonify({'success': False, 'message': '会话不存在'}), 404
    
    logging.debug(f"返回会话状态: {session.get('status')}")
    return jsonify({
        'success': True,
        'session': session
    })


@app.route('/api/logs/<session_id>/poll')
def poll_logs(session_id):
    session = get_session(session_id)
    
    if not session:
        return jsonify({'success': False, 'message': '会话不存在'}), 404
    
    return jsonify({
        'success': True,
        'status': session.get('status'),
        'progress': session.get('progress', 0),
        'results': session.get('results', []),
        'current_topic': session.get('current_topic', '')
    })





@app.route('/api/generate', methods=['POST'])
def generate():
    session_id = request.headers.get('X-Session-ID', request.json.get('session_id', 'default'))
    
    update_session(session_id, {
        'status': 'generating',
        'progress': 0,
        'results': []
    })
    
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
        logging.info(f"使用用户提供的DeepSeek API Key: {api_key[:10]}...")

        complete_fixed_info = {**DEFAULT_FIXED_COURSE_INFO, **fixed_course_info}
        course_info = {**complete_fixed_info, **variable_course_info}
        
        lesson_id = str(lesson_index)
        docs = uploaded_documents.get(lesson_id, [])
        if docs:
            course_info['参考文档'] = [
                {'filename': doc.get('filename', '未命名文档'), 'content': doc.get('content', '')}
                for doc in docs
            ]
            logging.info(f"已关联 {len(docs)} 个参考文档")

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


@app.route('/api/batch-generate', methods=['POST'])
def batch_generate():
    session_id = request.headers.get('X-Session-ID', request.json.get('session_id', 'default'))
    
    update_session(session_id, {
        'status': 'generating',
        'progress': 0,
        'results': [],
        'total_lessons': 0,
        'current_lesson': 0
    })
    
    # 配置 jiaoan logger
    jiaoan_logger = logging.getLogger('jiaoan')
    jiaoan_logger.setLevel(logging.DEBUG)
    
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
        logging.info("=" * 50)
        logging.info("🎯 开始批量生成教案")
        logging.info(f"📚 总课时数: {len(variable_course_infos)}")
        logging.info("=" * 50)

        complete_fixed_info = {**DEFAULT_FIXED_COURSE_INFO, **fixed_course_info}
        
        total_lessons = len(variable_course_infos)
        # 设置初始的 current_topic
        first_topic = variable_course_infos[0].get('课题名称', '课时1') if variable_course_infos else '准备中...'
        update_session(session_id, {
            'total_lessons': total_lessons,
            'current_topic': first_topic
        })
        
        results = []
        
        for i, lesson in enumerate(variable_course_infos, 1):
            lesson_id = str(lesson.get('id', ''))
            logging.info(f"📖 正在生成课时 {i}/{total_lessons}: {lesson.get('课题名称', '未命名')}")
            
            if lesson_id and lesson_id in uploaded_documents:
                docs = uploaded_documents[lesson_id]
                if docs:
                    lesson['参考文档'] = [
                        {'filename': doc['filename'], 'content': doc['content']}
                        for doc in docs
                    ]
                    logging.info(f"📎 已关联 {len(docs)} 个参考文档: {', '.join([d['filename'] for d in docs])}")
            
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
            
            logging.info("📝 正在调用 AI 生成教案内容...")
            
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
                logging.info(f"✅ 课时 {i} 生成成功: {topic}")
            else:
                results.append({
                    'topic': topic,
                    'status': '失败',
                    'message': '文件未生成'
                })
                logging.error(f"❌ 课时 {i} 生成失败: {topic}")
            
            update_session(session_id, {'results': results})
        
        update_session(session_id, {
            'status': 'completed',
            'progress': 100,
            'results': results
        })
        
        logging.info("=" * 50)
        logging.info(f"🎉 全部完成！成功 {len([r for r in results if r['status'] == '成功'])} 个，失败 {len([r for r in results if r['status'] == '失败'])} 个")
        logging.info("=" * 50)
        
        return jsonify({'success': True, 'results': results})

    except Exception as e:
        logging.error(f"生成失败: {str(e)}")
        update_session(session_id, {'status': 'error', 'error': str(e)})
        return jsonify({'success': False, 'message': f'生成失败: {str(e)}'}), 500


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
        
        file_content = file.read()
        original_size = len(file_content)
        logging.info(f"接收到文件: {file.filename}, 原始大小: {original_size} 字节")
        
        safe_filename = f"{lesson_id}_{int(time.time())}_{file.filename}"
        file_path = os.path.join(UPLOAD_DIR, safe_filename)
        
        with open(file_path, 'wb') as f:
            f.write(file_content)
        
        saved_size = os.path.getsize(file_path)
        logging.info(f"文件已保存到: {file_path}")
        logging.info(f"保存后大小: {saved_size} 字节")
        
        if saved_size != original_size:
            logging.warning(f"文件大小不匹配! 原始: {original_size}, 保存: {saved_size}")
            return jsonify({'success': False, 'message': '文件保存不完整'}), 500
        
        content = extract_document_content(file_path)
        
        if content is None:
            error_msg = f"❌ 文档解析失败: {file.filename} - 无法提取文档内容，请检查文件格式是否正确或文件是否损坏"
            logging.error(error_msg)
            # 删除上传的文件
            try:
                os.remove(file_path)
            except:
                pass
            return jsonify({
                'success': False,
                'message': error_msg,
                'error_type': 'parse_failed',
                'filename': file.filename
            }), 400
        
        content_summary = content[:500] if content else ""
        
        doc_info = {
            'filename': file.filename,
            'filepath': file_path,
            'content': content,
            'content_summary': content_summary,
            'file_size': saved_size,
            'upload_time': time.strftime('%Y-%m-%d %H:%M:%S')
        }
        
        # 追加文档到列表，而不是覆盖
        if lesson_id not in uploaded_documents:
            uploaded_documents[lesson_id] = []
        uploaded_documents[lesson_id].append(doc_info)
        
        success_msg = f"✅ 文档上传成功: {file.filename} (字符数: {len(content)})"
        logging.info(success_msg)
        
        return jsonify({
            'success': True,
            'message': success_msg,
            'document': {
                'filename': file.filename,
                'file_size': doc_info['file_size'],
                'content_summary': content_summary,
                'upload_time': doc_info['upload_time']
            }
        })
        
    except Exception as e:
        logging.error(f"上传文档失败: {str(e)}")
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
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False, threaded=True)
