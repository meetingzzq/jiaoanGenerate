import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Form, Input, Button, Card, List, Typography, notification, message, Badge, Tag, Upload, Spin } from 'antd';
import { UploadOutlined, FileOutlined, DeleteOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, FileTextOutlined, CloudUploadOutlined, ThunderboltOutlined, LoadingOutlined } from '@ant-design/icons';
import axios from 'axios';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const { Header, Content, Footer } = Layout;
const { Title, Text } = Typography;
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
    { id: 1, 课题名称: '电子元器件认识', 授课地点: '电子实训室', 授课时间: '2026年2月15日', 授课学时: '2学时', 授课类型: '理论课', 用户描述: '' },
    { id: 2, 课题名称: '焊接5步法', 授课地点: '焊接实训室', 授课时间: '2026年2月16日', 授课学时: '3学时', 授课类型: '理实一体化', 用户描述: '' }
  ]);

  const [lessonDocuments, setLessonDocuments] = useState({});
  const [apiKey, setApiKey] = useState(localStorage.getItem('deepseek_api_key') || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationResults, setGenerationResults] = useState([]);
  const [backendLogs, setBackendLogs] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [currentTopic, setCurrentTopic] = useState('');
  const [uploadingFiles, setUploadingFiles] = useState({});
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
        setGenerationResults(session.results || []);
        
        if (session.logs && session.logs.length > 0) {
          setBackendLogs(session.logs.flat());
          lastLogIndexRef.current = session.logs.length;
        }
        
        if (session.status === 'generating') {
          setIsGenerating(true);
          setCurrentTopic(session.current_topic || '');
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
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/logs/${sessionId}/poll?last_index=${lastLogIndexRef.current}`,
          { timeout: 5000 }
        );
        
        if (response.data.success) {
          const { logs, total_logs, status, results, current_topic } = response.data;
          
          if (logs && logs.length > 0) {
            const newLogs = logs.flat();
            setBackendLogs(prev => [...prev, ...newLogs]);
            lastLogIndexRef.current = total_logs;
          }
          
          setSessionStatus(status);
          setCurrentTopic(current_topic || '');
          
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
      用户描述: ''
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
    const uploadKey = `${lessonId}-${file.name}`;
    setUploadingFiles(prev => ({ ...prev, [uploadKey]: true }));
    
    const formData = new FormData();
    formData.append('file', file);
    formData.append('lesson_id', lessonId.toString());

    try {
      const response = await axios.post(`${API_BASE_URL}/api/upload-document`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024
      });

      if (response.data.success) {
        setLessonDocuments(prev => ({
          ...prev,
          [lessonId]: [...(prev[lessonId] || []), response.data.document]
        }));
        message.success(`文档 "${file.name}" 上传成功 (${formatFileSize(file.size)})`);
        return true;
      } else {
        message.error(response.data.message || '上传失败');
        return false;
      }
    } catch (error) {
      console.error('上传文档失败:', error);
      message.error(error.response?.data?.message || '上传文档失败');
      return false;
    } finally {
      setUploadingFiles(prev => {
        const newState = { ...prev };
        delete newState[uploadKey];
        return newState;
      });
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
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const generateLessonPlans = async () => {
    if (!apiKey || apiKey.trim() === '') {
      notification.error({
        message: 'API Key 未填写',
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
        headers: { 'X-Session-ID': sessionId },
        timeout: 300000
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
          message: 'API Key 无效',
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
    }
  };

  const getLogStyle = (msg) => {
    if (!msg) return { color: '#94a3b8' };
    if (msg.includes('失败') || msg.includes('错误') || msg.includes('Error') || msg.includes('error')) {
      return { color: '#f87171' };
    }
    if (msg.includes('成功') || msg.includes('完成')) {
      return { color: '#4ade80' };
    }
    if (msg.includes('开始') || msg.includes('正在')) {
      return { color: '#60a5fa' };
    }
    return { color: '#94a3b8' };
  };

  return (
    <Layout style={{ minHeight: '100vh', background: '#0f172a' }}>
      <Header style={{ 
        background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)', 
        borderBottom: '1px solid #334155',
        padding: '0 32px',
        height: 72,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ 
            width: 44, 
            height: 44, 
            borderRadius: 12, 
            background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            fontSize: 22,
            boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
          }}>
            📚
          </div>
          <div>
            <div style={{ color: '#f1f5f9', fontSize: 18, fontWeight: 600 }}>相城中专教案生成系统</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>作者：祝志强</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {sessionStatus === 'generating' && !isGenerating && (
            <Button 
              onClick={recoverSession}
              icon={<ReloadOutlined />}
              style={{ 
                background: '#1e293b', 
                border: '1px solid #334155',
                color: '#94a3b8',
                borderRadius: 8
              }}
            >
              恢复会话
            </Button>
          )}
          <Button 
            type="primary" 
            onClick={generateLessonPlans} 
            loading={isGenerating}
            disabled={isGenerating}
            icon={<ThunderboltOutlined />}
            style={{ 
              background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)',
              border: 'none',
              height: 42,
              padding: '0 24px',
              fontWeight: 600,
              borderRadius: 10,
              boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)'
            }}
          >
            {isGenerating ? '生成中...' : '批量生成教案'}
          </Button>
        </div>
      </Header>

      <Content style={{ padding: '24px 32px' }}>
        <div style={{ maxWidth: 1400, margin: '0 auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: backendLogs.length > 0 || isGenerating ? '1fr 380px' : '1fr', gap: 24, alignItems: 'start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <Card 
                style={{ 
                  background: '#1e293b', 
                  borderRadius: 16, 
                  border: '1px solid #334155',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.2)'
                }}
                styles={{ body: { padding: 24 } }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <div style={{ width: 4, height: 20, background: 'linear-gradient(180deg, #3b82f6 0%, #8b5cf6 100%)', borderRadius: 2 }} />
                  <span style={{ color: '#f1f5f9', fontSize: 16, fontWeight: 600 }}>固定课程信息</span>
                </div>
                <Form layout="vertical">
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                    {['院系', '授课班级', '专业名称'].map(field => (
                      <Form.Item key={field} label={<span style={{ color: '#94a3b8', fontSize: 13 }}>{field}</span>} style={{ marginBottom: 12 }}>
                        <Input 
                          value={fixedInfo[field]} 
                          onChange={(e) => setFixedInfo({ ...fixedInfo, [field]: e.target.value })} 
                          style={{ 
                            background: '#0f172a', 
                            border: '1px solid #334155', 
                            color: '#f1f5f9',
                            borderRadius: 8,
                            height: 38
                          }}
                        />
                      </Form.Item>
                    ))}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                    {['课程名称', '授课教师'].map(field => (
                      <Form.Item key={field} label={<span style={{ color: '#94a3b8', fontSize: 13 }}>{field}</span>} style={{ marginBottom: 12 }}>
                        <Input 
                          value={fixedInfo[field]} 
                          onChange={(e) => setFixedInfo({ ...fixedInfo, [field]: e.target.value })} 
                          style={{ 
                            background: '#0f172a', 
                            border: '1px solid #334155', 
                            color: '#f1f5f9',
                            borderRadius: 8,
                            height: 38
                          }}
                        />
                      </Form.Item>
                    ))}
                  </div>
                  <Form.Item label={<span style={{ color: '#94a3b8', fontSize: 13 }}>课程描述 <span style={{ color: '#475569' }}>（选填）</span></span>} style={{ marginBottom: 12 }}>
                    <TextArea
                      value={fixedInfo.课程描述}
                      onChange={(e) => setFixedInfo({ ...fixedInfo, 课程描述: e.target.value })}
                      style={{ 
                        background: '#0f172a', 
                        border: '1px solid #334155', 
                        color: '#f1f5f9',
                        borderRadius: 8
                      }}
                      placeholder="描述整个课程的目标、特点..."
                      rows={2}
                    />
                  </Form.Item>
                  <Form.Item label={<span style={{ color: '#f87171', fontSize: 13 }}>🔑 DeepSeek API Key *</span>} style={{ marginBottom: 0 }} required>
                    <Input.Password
                      value={apiKey}
                      onChange={handleApiKeyChange}
                      style={{ 
                        background: '#0f172a', 
                        border: '1px solid #334155', 
                        color: '#f1f5f9',
                        borderRadius: 8,
                        height: 38
                      }}
                      placeholder="请输入您的DeepSeek API Key"
                    />
                  </Form.Item>
                </Form>
              </Card>

              <Card 
                style={{ 
                  background: '#1e293b', 
                  borderRadius: 16, 
                  border: '1px solid #334155',
                  boxShadow: '0 4px 24px rgba(0,0,0,0.2)'
                }}
                styles={{ body: { padding: 24 } }}
                title={
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 4, height: 20, background: 'linear-gradient(180deg, #3b82f6 0%, #8b5cf6 100%)', borderRadius: 2 }} />
                    <span style={{ color: '#f1f5f9', fontSize: 16, fontWeight: 600 }}>课时信息</span>
                    <Badge count={lessons.length} style={{ background: '#3b82f6', marginLeft: 4 }} />
                  </div>
                }
                extra={
                  <Button 
                    type="dashed" 
                    onClick={addLesson}
                    style={{ color: '#3b82f6', borderColor: '#3b82f6', borderRadius: 8 }}
                  >
                    + 添加课时
                  </Button>
                }
              >
                <List
                  dataSource={lessons}
                  renderItem={(lesson) => (
                    <div style={{ 
                      border: '1px solid #334155', 
                      borderRadius: 12, 
                      marginBottom: 16, 
                      background: '#0f172a',
                      overflow: 'hidden'
                    }}>
                      <div style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center', 
                        padding: '12px 16px',
                        background: '#1e293b',
                        borderBottom: '1px solid #334155'
                      }}>
                        <Tag style={{ 
                          background: 'linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)', 
                          border: 'none',
                          color: '#fff',
                          borderRadius: 6,
                          fontWeight: 500
                        }}>
                          课时 {lesson.id}
                        </Tag>
                        <Button 
                          danger 
                          size="small" 
                          type="text" 
                          onClick={() => removeLesson(lesson.id)}
                          style={{ color: '#f87171' }}
                        >
                          删除
                        </Button>
                      </div>
                      <div style={{ padding: 16 }}>
                        <Form layout="vertical">
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                            <Form.Item label={<span style={{ color: '#94a3b8', fontSize: 12 }}>课题名称</span>} style={{ marginBottom: 8 }}>
                              <Input 
                                value={lesson.课题名称} 
                                onChange={(e) => updateLesson(lesson.id, '课题名称', e.target.value)} 
                                style={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9', borderRadius: 6, height: 34 }}
                              />
                            </Form.Item>
                            <Form.Item label={<span style={{ color: '#94a3b8', fontSize: 12 }}>授课地点</span>} style={{ marginBottom: 8 }}>
                              <Input 
                                value={lesson.授课地点} 
                                onChange={(e) => updateLesson(lesson.id, '授课地点', e.target.value)} 
                                style={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9', borderRadius: 6, height: 34 }}
                              />
                            </Form.Item>
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                            <Form.Item label={<span style={{ color: '#94a3b8', fontSize: 12 }}>授课时间</span>} style={{ marginBottom: 8 }}>
                              <Input 
                                value={lesson.授课时间} 
                                onChange={(e) => updateLesson(lesson.id, '授课时间', e.target.value)} 
                                style={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9', borderRadius: 6, height: 34 }}
                              />
                            </Form.Item>
                            <Form.Item label={<span style={{ color: '#94a3b8', fontSize: 12 }}>授课学时</span>} style={{ marginBottom: 8 }}>
                              <Input 
                                value={lesson.授课学时} 
                                onChange={(e) => updateLesson(lesson.id, '授课学时', e.target.value)} 
                                style={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9', borderRadius: 6, height: 34 }}
                              />
                            </Form.Item>
                            <Form.Item label={<span style={{ color: '#94a3b8', fontSize: 12 }}>授课类型</span>} style={{ marginBottom: 8 }}>
                              <Input 
                                value={lesson.授课类型} 
                                onChange={(e) => updateLesson(lesson.id, '授课类型', e.target.value)} 
                                style={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9', borderRadius: 6, height: 34 }}
                              />
                            </Form.Item>
                          </div>
                          <Form.Item label={<span style={{ color: '#94a3b8', fontSize: 12 }}>本节课描述 <span style={{ color: '#475569' }}>（选填）</span></span>} style={{ marginBottom: 8 }}>
                            <TextArea
                              value={lesson.用户描述}
                              onChange={(e) => updateLesson(lesson.id, '用户描述', e.target.value)}
                              style={{ background: '#1e293b', border: '1px solid #334155', color: '#f1f5f9', borderRadius: 6 }}
                              placeholder="描述上课内容、想法..."
                              rows={2}
                            />
                          </Form.Item>
                          <Form.Item label={<span style={{ color: '#94a3b8', fontSize: 12 }}>参考文档 <span style={{ color: '#475569' }}>（选填）</span></span>} style={{ marginBottom: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              {lessonDocuments[lesson.id]?.map((doc, index) => (
                                <Tag 
                                  key={index} 
                                  icon={<FileOutlined />}
                                  closable 
                                  onClose={() => handleDeleteDocument(lesson.id, doc.filename)}
                                  style={{ 
                                    background: '#1e293b', 
                                    border: '1px solid #334155',
                                    color: '#94a3b8',
                                    padding: '4px 10px',
                                    borderRadius: 6
                                  }}
                                >
                                  {doc.filename} ({formatFileSize(doc.file_size)})
                                </Tag>
                              ))}
                              {Object.values(uploadingFiles).some(v => v) && (
                                <Spin indicator={<LoadingOutlined style={{ color: '#3b82f6' }} spin />} />
                              )}
                              <Upload
                                beforeUpload={(file) => { handleDocumentUpload(lesson.id, file); return false; }}
                                showUploadList={false}
                                accept=".docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.pdf"
                              >
                                <Button 
                                  size="small" 
                                  icon={<CloudUploadOutlined />}
                                  style={{ 
                                    background: '#1e293b', 
                                    border: '1px solid #334155',
                                    color: '#94a3b8',
                                    borderRadius: 6
                                  }}
                                >
                                  上传文档
                                </Button>
                              </Upload>
                            </div>
                          </Form.Item>
                        </Form>
                      </div>
                    </div>
                  )}
                />
              </Card>
            </div>

            {(backendLogs.length > 0 || isGenerating) && (
              <div style={{ position: 'sticky', top: 96 }}>
                {isGenerating && (
                  <Card 
                    style={{ 
                      background: '#1e293b', 
                      borderRadius: 12, 
                      border: '1px solid #334155',
                      marginBottom: 12
                    }}
                    styles={{ body: { padding: 16 } }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <SyncOutlined spin style={{ color: '#3b82f6', fontSize: 18 }} />
                      <div>
                        <div style={{ color: '#f1f5f9', fontWeight: 500 }}>正在生成教案...</div>
                        {currentTopic && <div style={{ color: '#64748b', fontSize: 12, marginTop: 2 }}>{currentTopic}</div>}
                      </div>
                    </div>
                  </Card>
                )}

                {backendLogs.length > 0 && (
                  <Card 
                    style={{ 
                      background: '#1e293b', 
                      borderRadius: 12, 
                      border: '1px solid #334155',
                      marginBottom: 12
                    }}
                    styles={{ body: { padding: 0 } }}
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 0' }}>
                        <FileTextOutlined style={{ color: '#3b82f6' }} />
                        <span style={{ color: '#f1f5f9', fontWeight: 500 }}>实时日志</span>
                        {isGenerating && <SyncOutlined spin style={{ color: '#3b82f6', marginLeft: 4 }} />}
                      </div>
                    }
                  >
                    <div style={{ 
                      maxHeight: 280, 
                      overflow: 'auto', 
                      background: '#0f172a', 
                      padding: 12,
                      borderRadius: '0 0 12px 12px',
                      fontFamily: '"JetBrains Mono", "Fira Code", monospace',
                      fontSize: 12
                    }}>
                      {backendLogs.map((log, index) => (
                        <div key={index} style={{ 
                          padding: '3px 0',
                          lineHeight: 1.5,
                          borderBottom: index < backendLogs.length - 1 ? '1px solid #1e293b' : 'none',
                          ...getLogStyle(log.message)
                        }}>
                          <span style={{ color: '#475569', marginRight: 8 }}>[{log.time}]</span>
                          {log.message}
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  </Card>
                )}

                {generationResults.length > 0 && (
                  <Card 
                    style={{ 
                      background: '#1e293b', 
                      borderRadius: 12, 
                      border: '1px solid #334155'
                    }}
                    styles={{ body: { padding: 16 } }}
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {generationResults.every(r => r.status === '成功') ? 
                          <CheckCircleOutlined style={{ color: '#4ade80' }} /> : 
                          <CloseCircleOutlined style={{ color: '#f87171' }} />
                        }
                        <span style={{ color: '#f1f5f9', fontWeight: 500 }}>生成结果</span>
                      </div>
                    }
                  >
                    {generationResults.map((result, index) => (
                      <div key={index} style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        gap: 10, 
                        padding: '8px 0',
                        borderBottom: index < generationResults.length - 1 ? '1px solid #334155' : 'none'
                      }}>
                        {result.status === '成功' ? 
                          <CheckCircleOutlined style={{ color: '#4ade80' }} /> : 
                          <CloseCircleOutlined style={{ color: '#f87171' }} />
                        }
                        <span style={{ color: '#f1f5f9', flex: 1, fontSize: 13 }}>{result.topic}</span>
                        {result.file_url && (
                          <Button 
                            type="link" 
                            href={`${API_BASE_URL}${result.file_url}`} 
                            target="_blank"
                            style={{ color: '#3b82f6', padding: 0, fontSize: 13 }}
                          >
                            下载
                          </Button>
                        )}
                      </div>
                    ))}
                  </Card>
                )}
              </div>
            )}
          </div>
        </div>
      </Content>
      <Footer style={{ 
        textAlign: 'center', 
        background: 'transparent', 
        color: '#475569',
        padding: '24px 50px',
        fontSize: 12
      }}>
        相城中专教案生成系统 ©{new Date().getFullYear()}
      </Footer>
    </Layout>
  );
}

export default App;
