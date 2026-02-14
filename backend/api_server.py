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
from flask import Flask, request, jsonify, send_from_directory, Response, stream_with_context
from flask_cors import CORS

RENDER_DATA_DIR = os.environ.get('RENDER_DATA_DIR', '')

def get_resource_path(relative_path):
    """获取资源文件的绝对路径，支持开发环境和PyInstaller打包环境"""
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.abspath('.'), relative_path)

def get_base_dir():
    """获取程序运行的基础目录"""
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


class LogCapture:
    """捕获print输出的日志捕获器"""
    def __init__(self, session_id):
        self.session_id = session_id
        self.original_stdout = sys.stdout
        self.log_buffer = []
        
    def write(self, message):
        # 写入原始stdout
        self.original_stdout.write(message)
        self.original_stdout.flush()
        
        # 如果消息不为空，添加到队列
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
    """获取或创建日志队列"""
    with log_queues_lock:
        if session_id not in log_queues:
            log_queues[session_id] = queue.Queue()
        return log_queues[session_id]


def clear_log_queue(session_id):
    """清理日志队列"""
    with log_queues_lock:
        if session_id in log_queues:
            # 清空队列
            while not log_queues[session_id].empty():
                try:
                    log_queues[session_id].get_nowait()
                except queue.Empty:
                    break


@app.route('/api/logs/<session_id>')
def stream_logs(session_id):
    """
    SSE日志流接口 - 实时推送生成日志
    """
    def generate():
        # 获取或创建队列
        log_queue = get_log_queue(session_id)
        
        # 发送初始连接成功消息
        yield f"data: {json.dumps({'type': 'connected', 'message': '日志连接已建立'})}\n\n"
        
        try:
            while True:
                try:
                    # 等待日志消息，超时1秒
                    log_entry = log_queue.get(timeout=1)
                    yield f"data: {json.dumps({'type': 'log', 'data': log_entry})}\n\n"
                except queue.Empty:
                    # 发送心跳保持连接
                    yield f"data: {json.dumps({'type': 'heartbeat'})}\n\n"
                    continue
        except GeneratorExit:
            # 客户端断开连接
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
    """
    生成单个教案
    """
    # 获取session_id用于日志关联
    session_id = request.headers.get('X-Session-ID', 'default')
    
    # 清理之前的日志
    clear_log_queue(session_id)
    
    # 设置日志捕获
    log_capture = LogCapture(session_id)
    old_stdout = sys.stdout
    sys.stdout = log_capture
    
    try:
        data = request.json
        if not data:
            return jsonify({
                'success': False,
                'message': '请提供生成参数'
            }), 400

        # 获取参数
        fixed_course_info = data.get('fixed_course_info', {})
        variable_course_info = data.get('variable_course_info', {})
        lesson_index = data.get('lesson_index', 1)
        api_key = data.get('api_key', '')

        if not variable_course_info:
            return jsonify({
                'success': False,
                'message': '请提供课时信息'
            }), 400

        # 检查是否提供了API Key
        if not api_key or api_key.strip() == '':
            return jsonify({
                'success': False,
                'error_type': 'missing_api_key',
                'message': '未提供DeepSeek API Key，请输入您的API Key'
            }), 400
        
        # 设置API Key到环境变量
        os.environ['DEEPSEEK_API_KEY'] = api_key
        print(f"使用用户提供的DeepSeek API Key: {api_key[:10]}...{api_key[-4:] if len(api_key) > 14 else ''} (长度: {len(api_key)})")

        # 构建完整的固定信息
        complete_fixed_info = {
            **DEFAULT_FIXED_COURSE_INFO,
            **fixed_course_info
        }

        # 合并课程信息
        course_info = {
            **complete_fixed_info,
            **variable_course_info
        }
        
        # 添加参考文档信息 - 从已上传的文档中获取
        lesson_id = str(lesson_index)
        docs = uploaded_documents.get(lesson_id, [])
        if docs:
            doc_names = [doc.get('filename', '未命名文档') for doc in docs]
            course_info['参考文档'] = [
                {
                    'filename': doc.get('filename', '未命名文档'),
                    'content': doc.get('content', '')
                }
                for doc in docs
            ]
            print(f"已关联 {len(docs)} 个参考文档到当前课时: {', '.join(doc_names)}")
        else:
            # 尝试从前端传入的文档中获取（向后兼容）
            front_docs = variable_course_info.get('documents', [])
            if front_docs:
                front_doc_names = [doc.get('filename', '未命名文档') for doc in front_docs]
                print(f"前端传入了 {len(front_docs)} 个文档，但未包含内容: {', '.join(front_doc_names)}")

        # 生成输出文件名
        topic = course_info.get('课题名称', f'课时{lesson_index}')
        safe_topic = topic.replace('\\', '-').replace('/', '-').replace(':', '-').replace('*', '-').replace('?', '-').replace('"', '-').replace('<', '-').replace('>', '-').replace('|', '-')
        file_name = f"{lesson_index:02d}_{safe_topic}.docx"
        output_path = os.path.join(OUTPUT_DIR, file_name)

        # 调用生成函数
        template_path = os.path.join(os.path.dirname(__file__), 'moban.docx')
        success = generate_lesson_plan_doc(
            template_path=template_path,
            output_path=output_path,
            course_info=course_info,
            use_mock=False  # 使用大模型
        )

        # 检查API Key是否无效
        if success == "invalid_api_key":
            return jsonify({
                'success': False,
                'error_type': 'invalid_api_key',
                'message': 'DeepSeek API Key无效或已过期，请检查您的API Key是否正确'
            }), 401

        # 生成结果
        if success and os.path.exists(output_path):
            result = {
                'topic': topic,
                'status': '成功',
                'file_name': file_name,
                'file_url': f'/download/{file_name}'
            }
            return jsonify({
                'success': True,
                'result': result
            })
        else:
            return jsonify({
                'success': False,
                'message': '文件未生成'
            })

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'生成失败: {str(e)}'
        }), 500
    finally:
        # 恢复原始stdout
        sys.stdout = old_stdout


@app.route('/api/batch-generate', methods=['POST'])
def batch_generate():
    """
    批量生成教案
    """
    # 获取session_id用于日志关联
    session_id = request.headers.get('X-Session-ID', 'default')
    
    # 清理之前的日志
    clear_log_queue(session_id)
    
    # 设置日志捕获
    log_capture = LogCapture(session_id)
    old_stdout = sys.stdout
    sys.stdout = log_capture
    
    try:
        data = request.json
        if not data:
            return jsonify({
                'success': False,
                'message': '请提供生成参数'
            }), 400

        # 获取参数
        fixed_course_info = data.get('fixed_course_info', {})
        variable_course_infos = data.get('variable_course_infos', [])
        api_key = data.get('api_key', '')

        if not variable_course_infos:
            return jsonify({
                'success': False,
                'message': '请至少提供一个课时信息'
            }), 400

        # 检查是否提供了API Key
        if not api_key or api_key.strip() == '':
            return jsonify({
                'success': False,
                'error_type': 'missing_api_key',
                'message': '未提供DeepSeek API Key，请输入您的API Key'
            }), 400
        
        # 设置API Key到环境变量
        os.environ['DEEPSEEK_API_KEY'] = api_key
        print("使用用户提供的DeepSeek API Key")

        # 构建完整的固定信息
        complete_fixed_info = {
            **DEFAULT_FIXED_COURSE_INFO,
            **fixed_course_info
        }

        # 为每个课时添加参考文档信息
        for lesson in variable_course_infos:
            lesson_id = str(lesson.get('id', ''))
            if lesson_id and lesson_id in uploaded_documents:
                # 获取该课时上传的文档
                docs = uploaded_documents[lesson_id]
                if docs:
                    lesson['参考文档'] = [
                        {
                            'filename': doc['filename'],
                            'content': doc['content']
                        }
                        for doc in docs
                    ]
                    print(f"课时 {lesson_id}: 已关联 {len(docs)} 个参考文档")
        
        # 调用批量生成函数
        template_path = os.path.join(os.path.dirname(__file__), 'moban.docx')
        success = batch_generate_lesson_plans(
            template_path=template_path,
            output_dir=OUTPUT_DIR,
            fixed_course_info=complete_fixed_info,
            variable_course_infos=variable_course_infos,
            use_mock=False  # 使用大模型
        )

        # 生成结果
        results = []
        if success:
            for i, lesson in enumerate(variable_course_infos, 1):
                topic = lesson.get('课题名称', f'课时{i}')
                safe_topic = topic.replace('\\', '-').replace('/', '-').replace(':', '-').replace('*', '-').replace('?', '-').replace('"', '-').replace('<', '-').replace('>', '-').replace('|', '-')
                file_name = f"{i:02d}_{safe_topic}.docx"
                file_path = os.path.join(OUTPUT_DIR, file_name)
                
                if os.path.exists(file_path):
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

        return jsonify({
            'success': success,
            'results': results
        })

    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'生成失败: {str(e)}'
        }), 500
    finally:
        # 恢复原始stdout
        sys.stdout = old_stdout


@app.route('/api/upload-document', methods=['POST'])
def upload_document():
    """
    上传文档并提取内容
    """
    try:
        # 获取上传的文件
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'message': '没有上传文件'
            }), 400
        
        file = request.files['file']
        lesson_id = request.form.get('lesson_id', '')
        
        if file.filename == '':
            return jsonify({
                'success': False,
                'message': '文件名为空'
            }), 400
        
        # 检查文件类型
        allowed_extensions = {'.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.txt', '.pdf'}
        file_ext = os.path.splitext(file.filename)[1].lower()
        
        if file_ext not in allowed_extensions:
            return jsonify({
                'success': False,
                'message': f'不支持的文件格式: {file_ext}。支持的格式: {", ".join(allowed_extensions)}'
            }), 400
        
        # 保存文件
        safe_filename = f"{lesson_id}_{int(time.time())}_{file.filename}"
        file_path = os.path.join(UPLOAD_DIR, safe_filename)
        file.save(file_path)
        
        print(f"文档已上传: {file_path}")
        
        # 提取文档内容
        content = extract_document_content(file_path)
        
        if content is None:
            # 删除上传的文件
            os.remove(file_path)
            return jsonify({
                'success': False,
                'message': '无法提取文档内容，请检查文件格式是否正确'
            }), 400
        
        # 获取内容摘要
        content_summary = get_document_summary(file_path, max_length=500)
        
        # 存储文档信息
        doc_info = {
            'filename': file.filename,
            'filepath': file_path,
            'content': content,
            'content_summary': content_summary,
            'file_size': os.path.getsize(file_path),
            'upload_time': time.strftime('%Y-%m-%d %H:%M:%S')
        }
        
        # 添加到上传文档字典
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
        return jsonify({
            'success': False,
            'message': f'上传失败: {str(e)}'
        }), 500


@app.route('/api/documents/<lesson_id>', methods=['GET'])
def get_documents(lesson_id):
    """
    获取指定课时的已上传文档列表
    """
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
        return jsonify({
            'success': False,
            'message': f'获取文档列表失败: {str(e)}'
        }), 500


@app.route('/api/documents/<lesson_id>/<filename>', methods=['DELETE'])
def delete_document(lesson_id, filename):
    """
    删除指定课时的文档
    """
    try:
        if lesson_id in uploaded_documents:
            docs = uploaded_documents[lesson_id]
            for i, doc in enumerate(docs):
                if doc['filename'] == filename:
                    # 删除文件
                    if os.path.exists(doc['filepath']):
                        os.remove(doc['filepath'])
                    # 从列表中移除
                    uploaded_documents[lesson_id].pop(i)
                    return jsonify({
                        'success': True,
                        'message': '文档删除成功'
                    })
        
        return jsonify({
            'success': False,
            'message': '文档不存在'
        }), 404
        
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'删除失败: {str(e)}'
        }), 500


@app.route('/download/<filename>', methods=['GET'])
def download_file(filename):
    """
    下载生成的教案文件
    """
    try:
        return send_from_directory(OUTPUT_DIR, filename, as_attachment=True)
    except Exception as e:
        return jsonify({
            'success': False,
            'message': f'下载失败: {str(e)}'
        }), 404


@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_frontend(path):
    """
    提供前端静态文件
    """
    if path and os.path.exists(os.path.join(STATIC_DIR, path)):
        return send_from_directory(STATIC_DIR, path)
    else:
        return send_from_directory(STATIC_DIR, 'index.html')


if __name__ == '__main__':
    # 开发模式
    app.run(host='0.0.0.0', port=5000, debug=True, threaded=True)
