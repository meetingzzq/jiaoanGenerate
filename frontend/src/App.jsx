import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Form, Input, Button, Card, List, Typography, notification, message, Space, Badge, Tooltip, Collapse, Upload, Tag, Progress } from 'antd';
import { UploadOutlined, FileOutlined, DeleteOutlined, SyncOutlined, ReloadOutlined } from '@ant-design/icons';
import axios from 'axios';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const { Header, Content, Footer } = Layout;
const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;
const { TextArea } = Input;

function App() {
  const [fixedInfo, setFixedInfo] = useState({
    院系: '智能装备学院',
    授课班级: '电气自动化（2）班',
    专业名称: '电气自动化',
    课程名称: '电子焊接',
    授课教师: '张老师',
    课程描述: ''
  });

  const [lessons, setLessons] = useState([
    { id: 1, 课题名称: '电子元器件认识', 授课地点: '电子实训室', 授课时间: '2026年2月15日', 授课学时: '2学时', 授课类型: '理论课', 用户描述: '', documents: [] },
    { id: 2, 课题名称: '焊接5步法', 授课地点: '焊接实训室', 授课时间: '2026年2月16日', 授课学时: '3学时', 授课类型: '理实一体化', 用户描述: '', documents: [] }
  ]);

  const [lessonDocuments, setLessonDocuments] = useState({});
  const [apiKey, setApiKey] = useState(localStorage.getItem('deepseek_api_key') || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationResults, setGenerationResults] = useState([]);
  const [progress, setProgress] = useState(0);
  const [currentLessonIndex, setCurrentLessonIndex] = useState(0);
  const [backendLogs, setBackendLogs] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const logsEndRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const lastLogIndexRef = useRef(0);

  const scrollToBottom = useCallback(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [backendLogs, scrollToBottom]);

  useEffect(() => {
    const savedSessionId = localStorage.getItem('currentSessionId');
    const savedSessionTime = localStorage.getItem('sessionStartTime');
    
    if (savedSessionId && savedSessionTime) {
      const sessionAge = Date.now() - parseInt(savedSessionTime);
      if (sessionAge < 30 * 60 * 1000) {
        setCurrentSessionId(savedSessionId);
        checkSessionStatus(savedSessionId);
      } else {
        localStorage.removeItem('currentSessionId');
        localStorage.removeItem('sessionStartTime');
      }
    }
    
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  const checkSessionStatus = async (sessionId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/session/${sessionId}`);
      if (response.data.success) {
        const session = response.data.session;
        setSessionStatus(session.status);
        setProgress(session.progress || 0);
        setGenerationResults(session.results || []);
        
        if (session.status === 'generating') {
          setIsGenerating(true);
          startPolling(sessionId);
        } else if (session.status === 'completed' || session.status === 'error') {
          setIsGenerating(false);
        }
      }
    } catch (error) {
      console.log('Session not found or expired');
      localStorage.removeItem('currentSessionId');
      localStorage.removeItem('sessionStartTime');
    }
  };

  const startPolling = (sessionId) => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }
    
    lastLogIndexRef.current = 0;
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/logs/${sessionId}/poll?last_index=${lastLogIndexRef.current}`
        );
        
        if (response.data.success) {
          const { logs, total_logs, status, progress: newProgress, results } = response.data;
          
          if (logs && logs.length > 0) {
            const newLogs = logs.flat();
            setBackendLogs(prev => [...prev, ...newLogs]);
            lastLogIndexRef.current = total_logs;
          }
          
          setSessionStatus(status);
          setProgress(newProgress);
          
          if (results && results.length > 0) {
            setGenerationResults(results);
          }
          
          if (status === 'completed' || status === 'error') {
            setIsGenerating(false);
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
            }
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    }, 1000);
  };

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const addLesson = () => {
    const newId = lessons.length > 0 ? Math.max(...lessons.map(l => l.id)) + 1 : 1;
    setLessons([...lessons, {
      id: newId,
      课题名称: `课时${newId}`,
      授课地点: '',
      授课时间: '',
      授课学时: '1学时',
      授课类型: '理论课',
      用户描述: '',
      documents: []
    }]);
  };

  const removeLesson = (id) => {
    if (lessons.length > 1) {
      setLessons(lessons.filter(lesson => lesson.id !== id));
      message.success('课时删除成功');
    } else {
      message.warning('至少需要保留一个课时');
    }
  };

  const updateLesson = (id, field, value) => {
    setLessons(lessons.map(lesson =>
      lesson.id === id ? { ...lesson, [field]: value } : lesson
    ));
  };

  const handleApiKeyChange = (e) => {
    const newKey = e.target.value;
    setApiKey(newKey);
    localStorage.setItem('deepseek_api_key', newKey);
  };

  const handleDocumentUpload = async (lessonId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('lesson_id', lessonId.toString());

    try {
      const response = await axios.post(`${API_BASE_URL}/api/upload-document`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (response.data.success) {
        setLessonDocuments(prev => ({
          ...prev,
          [lessonId]: [...(prev[lessonId] || []), response.data.document]
        }));
        message.success(`文档 "${file.name}" 上传成功`);
        return true;
      } else {
        message.error(response.data.message || '上传失败');
        return false;
      }
    } catch (error) {
      console.error('上传文档失败:', error);
      message.error(error.response?.data?.message || '上传文档失败');
      return false;
    }
  };

  const handleDeleteDocument = async (lessonId, filename) => {
    try {
      const response = await axios.delete(`${API_BASE_URL}/api/documents/${lessonId}/${filename}`);
      if (response.data.success) {
        setLessonDocuments(prev => ({
          ...prev,
          [lessonId]: (prev[lessonId] || []).filter(doc => doc.filename !== filename)
        }));
        message.success('文档删除成功');
      }
    } catch (error) {
      message.error('删除文档失败');
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const generateLessonPlans = async () => {
    if (!apiKey || apiKey.trim() === '') {
      notification.error({
        message: '🔑 API Key 未填写',
        description: '请输入您的 DeepSeek API Key 才能生成教案',
        duration: 3
      });
      return;
    }

    const hasEmptyFields = lessons.some(lesson => 
      !lesson.课题名称 || !lesson.授课地点 || !lesson.授课时间 || !lesson.授课学时 || !lesson.授课类型
    );

    if (hasEmptyFields) {
      notification.error({ 
        message: '表单验证失败',
        description: '请填写所有课时的必填字段',
        duration: 3
      });
      return;
    }

    setIsGenerating(true);
    setProgress(0);
    setGenerationResults([]);
    setBackendLogs([]);
    lastLogIndexRef.current = 0;

    try {
      const sessionResponse = await axios.post(`${API_BASE_URL}/api/session`);
      const sessionId = sessionResponse.data.session_id;
      
      setCurrentSessionId(sessionId);
      localStorage.setItem('currentSessionId', sessionId);
      localStorage.setItem('sessionStartTime', Date.now().toString());
      
      startPolling(sessionId);

      const response = await axios.post(`${API_BASE_URL}/api/batch-generate`, {
        fixed_course_info: fixedInfo,
        variable_course_infos: lessons,
        api_key: apiKey,
        session_id: sessionId
      }, {
        headers: { 'X-Session-ID': sessionId }
      });

      if (response.data.success) {
        setGenerationResults(response.data.results);
        const successCount = response.data.results.filter(r => r.status === '成功').length;
        notification.success({ 
          message: '批量生成完成',
          description: `成功生成 ${successCount} 个教案`,
          duration: 3
        });
      } else if (response.data.error_type === 'invalid_api_key') {
        notification.error({
          message: '🔑 API Key 无效',
          description: 'DeepSeek API Key 无效或已过期',
          duration: 5
        });
      } else {
        notification.error({
          message: '生成失败',
          description: response.data.message,
          duration: 3
        });
      }
    } catch (error) {
      console.error('批量生成失败:', error);
      notification.error({ 
        message: '批量生成失败',
        description: error.response?.data?.message || '请检查后端服务',
        duration: 3
      });
    } finally {
      setIsGenerating(false);
      stopPolling();
    }
  };

  const recoverSession = async () => {
    if (currentSessionId) {
      setIsGenerating(true);
      startPolling(currentSessionId);
      
      const response = await axios.get(`${API_BASE_URL}/api/session/${currentSessionId}`);
      if (response.data.success) {
        const session = response.data.session;
        setGenerationResults(session.results || []);
        setBackendLogs(session.logs?.flat() || []);
        lastLogIndexRef.current = session.logs?.length || 0;
      }
    }
  };

  return (
    <Layout className="layout">
      <div className="floating-decoration">🌸</div>
      <div className="floating-decoration">🍃</div>
      <div className="floating-decoration">✨</div>
      <div className="floating-decoration">🌿</div>
      
      <Header className="header">
        <div className="header-content">
          <div className="header-icon">🎐</div>
          <div className="header-title-wrapper">
            <Title level={3} className="header-title">相城中专教案生成系统</Title>
            <span className="header-author">作者：祝志强</span>
          </div>
          <div className="header-decoration">
            <span className="cloud">☁️</span>
            <span className="star">✨</span>
          </div>
        </div>
        <div className="header-actions">
          {sessionStatus === 'generating' && !isGenerating && (
            <Button 
              type="default" 
              onClick={recoverSession}
              size="large"
              style={{ marginRight: 8 }}
            >
              <ReloadOutlined /> 恢复会话
            </Button>
          )}
          <Button 
            type="primary" 
            onClick={generateLessonPlans} 
            loading={isGenerating}
            disabled={isGenerating}
            size="large"
            className="generate-button"
          >
            {isGenerating ? `生成中... ${Math.round(progress)}%` : '🌸 批量生成教案'}
          </Button>
        </div>
      </Header>

      <Content className="main-content">
        <div className="card-container">
          {isGenerating && (
            <Card className="info-card ghibli-card" style={{ marginBottom: 16 }}>
              <div style={{ textAlign: 'center' }}>
                <Progress percent={Math.round(progress)} status="active" />
                <Text>正在生成教案... {sessionStatus === 'generating' && '（刷新页面后可点击"恢复会话"继续查看）'}</Text>
              </div>
            </Card>
          )}

          {backendLogs.length > 0 && (
            <Card 
              title={<span className="card-title">📋 生成日志</span>}
              className="info-card ghibli-card"
              style={{ marginBottom: 16 }}
            >
              <div style={{ maxHeight: 200, overflow: 'auto', backgroundColor: '#1e1e1e', padding: 12, borderRadius: 8 }}>
                {backendLogs.map((log, index) => (
                  <div key={index} style={{ color: '#4ec9b0', fontFamily: 'monospace', fontSize: 12 }}>
                    <span style={{ color: '#6a9955' }}>[{log.time}]</span> {log.message}
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </Card>
          )}

          {generationResults.length > 0 && (
            <Card 
              title={<span className="card-title">✅ 生成结果</span>}
              className="info-card ghibli-card"
              style={{ marginBottom: 16 }}
            >
              <List
                dataSource={generationResults}
                renderItem={(result, index) => (
                  <List.Item key={index}>
                    <Space>
                      <Badge 
                        status={result.status === '成功' ? 'success' : 'error'} 
                        text={result.status}
                      />
                      <Text strong>{result.topic}</Text>
                      {result.file_url && (
                        <Button 
                          type="link" 
                          href={`${API_BASE_URL}${result.file_url}`} 
                          target="_blank"
                        >
                          📥 下载教案
                        </Button>
                      )}
                      {result.message && <Text type="secondary">{result.message}</Text>}
                    </Space>
                  </List.Item>
                )}
              />
            </Card>
          )}

          <Card 
            title={<span className="card-title">📚 固定课程信息</span>}
            className="info-card ghibli-card"
          >
            <Form layout="vertical">
              <div className="form-row">
                <Form.Item label="院系" className="ghibli-form-item form-col-3">
                  <Input value={fixedInfo.院系} onChange={(e) => setFixedInfo({ ...fixedInfo, 院系: e.target.value })} className="ghibli-input" />
                </Form.Item>
                <Form.Item label="授课班级" className="ghibli-form-item form-col-3">
                  <Input value={fixedInfo.授课班级} onChange={(e) => setFixedInfo({ ...fixedInfo, 授课班级: e.target.value })} className="ghibli-input" />
                </Form.Item>
                <Form.Item label="专业名称" className="ghibli-form-item form-col-3">
                  <Input value={fixedInfo.专业名称} onChange={(e) => setFixedInfo({ ...fixedInfo, 专业名称: e.target.value })} className="ghibli-input" />
                </Form.Item>
              </div>
              <div className="form-row">
                <Form.Item label="课程名称" className="ghibli-form-item form-col-2">
                  <Input value={fixedInfo.课程名称} onChange={(e) => setFixedInfo({ ...fixedInfo, 课程名称: e.target.value })} className="ghibli-input" />
                </Form.Item>
                <Form.Item label="授课教师" className="ghibli-form-item form-col-2">
                  <Input value={fixedInfo.授课教师} onChange={(e) => setFixedInfo({ ...fixedInfo, 授课教师: e.target.value })} className="ghibli-input" />
                </Form.Item>
              </div>
              <div className="form-row">
                <Form.Item label={<span>📋 课程描述 <span style={{ color: '#999' }}>（选填）</span></span>} className="ghibli-form-item form-col-full">
                  <TextArea
                    value={fixedInfo.课程描述}
                    onChange={(e) => setFixedInfo({ ...fixedInfo, 课程描述: e.target.value })}
                    className="ghibli-textarea"
                    placeholder="描述整个课程的目标、特点..."
                    rows={3}
                  />
                </Form.Item>
              </div>
              <div className="form-row">
                <Form.Item label={<span>🔑 DeepSeek API Key <span style={{ color: '#ff4d4f' }}>*</span></span>} className="ghibli-form-item form-col-full" required>
                  <Input.Password
                    value={apiKey}
                    onChange={handleApiKeyChange}
                    className="ghibli-input"
                    placeholder="请输入您的DeepSeek API Key"
                  />
                </Form.Item>
              </div>
            </Form>
          </Card>

          <Card 
            title={<span className="card-title">📝 课时信息</span>}
            extra={
              <Button type="dashed" onClick={addLesson} className="add-lesson-button">
                ➕ 添加课时
              </Button>
            }
            className="info-card ghibli-card"
          >
            <List
              dataSource={lessons}
              renderItem={(lesson) => (
                <List.Item key={lesson.id} className="lesson-item" actions={[
                  <Tooltip title="删除课时" key="delete">
                    <Button danger size="small" onClick={() => removeLesson(lesson.id)}>🗑️</Button>
                  </Tooltip>
                ]}>
                  <Card size="small" title={<span>📖 课时 {lesson.id}</span>} className="lesson-card" style={{ width: '100%' }}>
                    <Form layout="vertical">
                      <div className="form-row">
                        <Form.Item label="课题名称" className="ghibli-form-item form-col-2">
                          <Input value={lesson.课题名称} onChange={(e) => updateLesson(lesson.id, '课题名称', e.target.value)} className="ghibli-input" />
                        </Form.Item>
                        <Form.Item label="授课地点" className="ghibli-form-item form-col-2">
                          <Input value={lesson.授课地点} onChange={(e) => updateLesson(lesson.id, '授课地点', e.target.value)} className="ghibli-input" />
                        </Form.Item>
                      </div>
                      <div className="form-row">
                        <Form.Item label="授课时间" className="ghibli-form-item form-col-3">
                          <Input value={lesson.授课时间} onChange={(e) => updateLesson(lesson.id, '授课时间', e.target.value)} className="ghibli-input" />
                        </Form.Item>
                        <Form.Item label="授课学时" className="ghibli-form-item form-col-3">
                          <Input value={lesson.授课学时} onChange={(e) => updateLesson(lesson.id, '授课学时', e.target.value)} className="ghibli-input" />
                        </Form.Item>
                        <Form.Item label="授课类型" className="ghibli-form-item form-col-3">
                          <Input value={lesson.授课类型} onChange={(e) => updateLesson(lesson.id, '授课类型', e.target.value)} className="ghibli-input" />
                        </Form.Item>
                      </div>
                      <Form.Item label={<span>💭 本节课描述 <span style={{ color: '#999' }}>（选填）</span></span>} className="ghibli-form-item">
                        <TextArea
                          value={lesson.用户描述}
                          onChange={(e) => updateLesson(lesson.id, '用户描述', e.target.value)}
                          className="ghibli-textarea"
                          placeholder="描述上课内容、想法..."
                          rows={3}
                        />
                      </Form.Item>
                      <Form.Item label={<span>📎 参考文档 <span style={{ color: '#999' }}>（选填）</span></span>} className="ghibli-form-item">
                        <div className="document-upload-section">
                          {lessonDocuments[lesson.id] && lessonDocuments[lesson.id].length > 0 && (
                            <div className="uploaded-documents-list">
                              {lessonDocuments[lesson.id].map((doc, index) => (
                                <div key={index} className="document-item">
                                  <FileOutlined className="document-icon" />
                                  <Text>{doc.filename}</Text>
                                  <Text type="secondary">({formatFileSize(doc.file_size)})</Text>
                                  <Button size="small" danger onClick={() => handleDeleteDocument(lesson.id, doc.filename)}>
                                    <DeleteOutlined />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                          <Upload
                            beforeUpload={(file) => { handleDocumentUpload(lesson.id, file); return false; }}
                            showUploadList={false}
                            accept=".docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.pdf"
                          >
                            <Button icon={<UploadOutlined />}>上传文档</Button>
                          </Upload>
                        </div>
                      </Form.Item>
                    </Form>
                  </Card>
                </List.Item>
              )}
            />
          </Card>
        </div>
      </Content>
      <Footer className="footer">
        相城中专教案生成系统 ©{new Date().getFullYear()}
      </Footer>
    </Layout>
  );
}

export default App;
