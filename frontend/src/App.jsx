import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Form, Input, Button, Card, List, Typography, notification, message, Space, Badge, Tooltip, Upload, Tag, Divider, Empty, Spin } from 'antd';
import { UploadOutlined, FileOutlined, DeleteOutlined, ReloadOutlined, CheckCircleOutlined, CloseCircleOutlined, SyncOutlined, FileTextOutlined, CloudUploadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import axios from 'axios';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

const { Header, Content, Footer } = Layout;
const { Title, Text, Paragraph } = Typography;
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
  const [backendLogs, setBackendLogs] = useState([]);
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessionStatus, setSessionStatus] = useState(null);
  const [currentTopic, setCurrentTopic] = useState('');
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
          `${API_BASE_URL}/api/logs/${sessionId}/poll?last_index=${lastLogIndexRef.current}`
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

  const renderLogItem = (log, index) => {
    const isError = log.message && (
      log.message.includes('失败') || 
      log.message.includes('错误') || 
      log.message.includes('Error') ||
      log.message.includes('error')
    );
    const isSuccess = log.message && (
      log.message.includes('成功') || 
      log.message.includes('完成') ||
      log.message.includes('Success')
    );
    
    return (
      <div 
        key={index} 
        style={{ 
          padding: '4px 0',
          color: isError ? '#ff6b6b' : isSuccess ? '#51cf66' : '#adb5bd',
          fontFamily: '"JetBrains Mono", "Fira Code", monospace',
          fontSize: '13px',
          lineHeight: '1.6',
          borderBottom: index < backendLogs.length - 1 ? '1px solid #2d2d2d' : 'none'
        }}
      >
        <span style={{ color: '#868e96', marginRight: 8 }}>[{log.time}]</span>
        {log.message}
      </div>
    );
  };

  return (
    <Layout className="layout" style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' }}>
      <Header className="header" style={{ 
        background: 'rgba(22, 33, 62, 0.95)', 
        backdropFilter: 'blur(10px)',
        borderBottom: '1px solid rgba(255,255,255,0.1)',
        padding: '0 24px',
        height: 'auto',
        lineHeight: 'normal'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ 
              width: 48, 
              height: 48, 
              borderRadius: 12, 
              background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center',
              fontSize: 24
            }}>
              📚
            </div>
            <div>
              <Title level={4} style={{ margin: 0, color: '#fff', fontWeight: 600 }}>
                相城中专教案生成系统
              </Title>
              <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 12 }}>作者：祝志强</Text>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            {sessionStatus === 'generating' && !isGenerating && (
              <Button 
                type="default" 
                onClick={recoverSession}
                icon={<ReloadOutlined />}
                style={{ 
                  background: 'rgba(255,255,255,0.1)', 
                  borderColor: 'rgba(255,255,255,0.2)',
                  color: '#fff'
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
                background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                borderColor: 'transparent',
                height: 40,
                fontWeight: 500
              }}
            >
              {isGenerating ? '生成中...' : '批量生成教案'}
            </Button>
          </div>
        </div>
      </Header>

      <Content style={{ padding: '24px', maxWidth: 1400, margin: '0 auto', width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: backendLogs.length > 0 || generationResults.length > 0 ? '1fr 400px' : '1fr', gap: 24 }}>
          <div>
            <Card 
              style={{ 
                background: 'rgba(255,255,255,0.03)', 
                borderRadius: 16, 
                border: '1px solid rgba(255,255,255,0.08)',
                marginBottom: 24
              }}
              bodyStyle={{ padding: 24 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                <div style={{ width: 4, height: 20, background: 'linear-gradient(180deg, #667eea 0%, #764ba2 100%)', borderRadius: 2 }} />
                <Title level={5} style={{ margin: 0, color: '#fff' }}>固定课程信息</Title>
              </div>
              <Form layout="vertical">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.7)' }}>院系</span>}>
                    <Input 
                      value={fixedInfo.院系} 
                      onChange={(e) => setFixedInfo({ ...fixedInfo, 院系: e.target.value })} 
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                    />
                  </Form.Item>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.7)' }}>授课班级</span>}>
                    <Input 
                      value={fixedInfo.授课班级} 
                      onChange={(e) => setFixedInfo({ ...fixedInfo, 授课班级: e.target.value })} 
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                    />
                  </Form.Item>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.7)' }}>专业名称</span>}>
                    <Input 
                      value={fixedInfo.专业名称} 
                      onChange={(e) => setFixedInfo({ ...fixedInfo, 专业名称: e.target.value })} 
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                    />
                  </Form.Item>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.7)' }}>课程名称</span>}>
                    <Input 
                      value={fixedInfo.课程名称} 
                      onChange={(e) => setFixedInfo({ ...fixedInfo, 课程名称: e.target.value })} 
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                    />
                  </Form.Item>
                  <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.7)' }}>授课教师</span>}>
                    <Input 
                      value={fixedInfo.授课教师} 
                      onChange={(e) => setFixedInfo({ ...fixedInfo, 授课教师: e.target.value })} 
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                    />
                  </Form.Item>
                </div>
                <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.7)' }}>课程描述 <span style={{ color: 'rgba(255,255,255,0.4)' }}>（选填）</span></span>}>
                  <TextArea
                    value={fixedInfo.课程描述}
                    onChange={(e) => setFixedInfo({ ...fixedInfo, 课程描述: e.target.value })}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                    placeholder="描述整个课程的目标、特点..."
                    rows={2}
                  />
                </Form.Item>
                <Form.Item label={<span style={{ color: '#ff6b6b' }}>🔑 DeepSeek API Key *</span>} required>
                  <Input.Password
                    value={apiKey}
                    onChange={handleApiKeyChange}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                    placeholder="请输入您的DeepSeek API Key"
                  />
                </Form.Item>
              </Form>
            </Card>

            <Card 
              style={{ 
                background: 'rgba(255,255,255,0.03)', 
                borderRadius: 16, 
                border: '1px solid rgba(255,255,255,0.08)'
              }}
              bodyStyle={{ padding: 24 }}
              title={
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 4, height: 20, background: 'linear-gradient(180deg, #667eea 0%, #764ba2 100%)', borderRadius: 2 }} />
                  <span style={{ color: '#fff', fontWeight: 600 }}>课时信息</span>
                  <Badge count={lessons.length} style={{ background: '#667eea' }} />
                </div>
              }
              extra={
                <Button 
                  type="dashed" 
                  onClick={addLesson}
                  style={{ color: '#667eea', borderColor: 'rgba(102,126,234,0.5)' }}
                >
                  + 添加课时
                </Button>
              }
            >
              <List
                dataSource={lessons}
                renderItem={(lesson) => (
                  <List.Item style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, marginBottom: 16, background: 'rgba(255,255,255,0.02)', padding: 16 }}>
                    <div style={{ width: '100%' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <Tag color="#667eea" style={{ borderRadius: 6 }}>课时 {lesson.id}</Tag>
                        <Button danger size="small" type="text" onClick={() => removeLesson(lesson.id)}>删除</Button>
                      </div>
                      <Form layout="vertical">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
                          <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>课题名称</span>} style={{ marginBottom: 12 }}>
                            <Input 
                              value={lesson.课题名称} 
                              onChange={(e) => updateLesson(lesson.id, '课题名称', e.target.value)} 
                              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                            />
                          </Form.Item>
                          <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>授课地点</span>} style={{ marginBottom: 12 }}>
                            <Input 
                              value={lesson.授课地点} 
                              onChange={(e) => updateLesson(lesson.id, '授课地点', e.target.value)} 
                              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                            />
                          </Form.Item>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                          <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>授课时间</span>} style={{ marginBottom: 12 }}>
                            <Input 
                              value={lesson.授课时间} 
                              onChange={(e) => updateLesson(lesson.id, '授课时间', e.target.value)} 
                              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                            />
                          </Form.Item>
                          <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>授课学时</span>} style={{ marginBottom: 12 }}>
                            <Input 
                              value={lesson.授课学时} 
                              onChange={(e) => updateLesson(lesson.id, '授课学时', e.target.value)} 
                              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                            />
                          </Form.Item>
                          <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>授课类型</span>} style={{ marginBottom: 12 }}>
                            <Input 
                              value={lesson.授课类型} 
                              onChange={(e) => updateLesson(lesson.id, '授课类型', e.target.value)} 
                              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                            />
                          </Form.Item>
                        </div>
                        <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>本节课描述 <span style={{ color: 'rgba(255,255,255,0.3)' }}>（选填）</span></span>} style={{ marginBottom: 12 }}>
                          <TextArea
                            value={lesson.用户描述}
                            onChange={(e) => updateLesson(lesson.id, '用户描述', e.target.value)}
                            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', color: '#fff' }}
                            placeholder="描述上课内容、想法..."
                            rows={2}
                          />
                        </Form.Item>
                        <Form.Item label={<span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>参考文档 <span style={{ color: 'rgba(255,255,255,0.3)' }}>（选填）</span></span>} style={{ marginBottom: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            {lessonDocuments[lesson.id] && lessonDocuments[lesson.id].map((doc, index) => (
                              <Tag 
                                key={index} 
                                icon={<FileOutlined />}
                                closable 
                                onClose={() => handleDeleteDocument(lesson.id, doc.filename)}
                                style={{ 
                                  background: 'rgba(102,126,234,0.2)', 
                                  border: '1px solid rgba(102,126,234,0.3)',
                                  color: '#a8b1ff',
                                  padding: '4px 8px'
                                }}
                              >
                                {doc.filename} ({formatFileSize(doc.file_size)})
                              </Tag>
                            ))}
                            <Upload
                              beforeUpload={(file) => { handleDocumentUpload(lesson.id, file); return false; }}
                              showUploadList={false}
                              accept=".docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.pdf"
                            >
                              <Button 
                                size="small" 
                                icon={<CloudUploadOutlined />}
                                style={{ 
                                  background: 'rgba(255,255,255,0.05)', 
                                  border: '1px solid rgba(255,255,255,0.1)',
                                  color: 'rgba(255,255,255,0.7)'
                                }}
                              >
                                上传文档
                              </Button>
                            </Upload>
                          </div>
                        </Form.Item>
                      </Form>
                    </div>
                  </List.Item>
                )}
              />
            </Card>
          </div>

          {(backendLogs.length > 0 || generationResults.length > 0) && (
            <div style={{ position: 'sticky', top: 24 }}>
              {isGenerating && (
                <Card 
                  style={{ 
                    background: 'rgba(255,255,255,0.03)', 
                    borderRadius: 16, 
                    border: '1px solid rgba(255,255,255,0.08)',
                    marginBottom: 16
                  }}
                  bodyStyle={{ padding: 16 }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <SyncOutlined spin style={{ color: '#667eea', fontSize: 18 }} />
                    <div>
                      <Text style={{ color: '#fff', fontWeight: 500 }}>正在生成教案...</Text>
                      {currentTopic && <Text style={{ color: 'rgba(255,255,255,0.5)', marginLeft: 8 }}>{currentTopic}</Text>}
                    </div>
                  </div>
                </Card>
              )}

              {backendLogs.length > 0 && (
                <Card 
                  style={{ 
                    background: 'rgba(255,255,255,0.03)', 
                    borderRadius: 16, 
                    border: '1px solid rgba(255,255,255,0.08)',
                    marginBottom: 16
                  }}
                  bodyStyle={{ padding: 0 }}
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '16px 20px 0' }}>
                      <FileTextOutlined style={{ color: '#667eea' }} />
                      <span style={{ color: '#fff', fontWeight: 500 }}>实时日志</span>
                      {isGenerating && <SyncOutlined spin style={{ color: '#667eea', marginLeft: 8 }} />}
                    </div>
                  }
                >
                  <div style={{ 
                    maxHeight: 300, 
                    overflow: 'auto', 
                    background: '#1a1a2e', 
                    padding: 12,
                    borderRadius: '0 0 12px 12px'
                  }}>
                    {backendLogs.map((log, index) => renderLogItem(log, index))}
                    <div ref={logsEndRef} />
                  </div>
                </Card>
              )}

              {generationResults.length > 0 && (
                <Card 
                  style={{ 
                    background: 'rgba(255,255,255,0.03)', 
                    borderRadius: 16, 
                    border: '1px solid rgba(255,255,255,0.08)'
                  }}
                  bodyStyle={{ padding: 16 }}
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {generationResults.every(r => r.status === '成功') ? 
                        <CheckCircleOutlined style={{ color: '#51cf66' }} /> : 
                        <CloseCircleOutlined style={{ color: '#ff6b6b' }} />
                      }
                      <span style={{ color: '#fff', fontWeight: 500 }}>生成结果</span>
                    </div>
                  }
                >
                  <List
                    dataSource={generationResults}
                    renderItem={(result) => (
                      <List.Item style={{ border: 'none', padding: '8px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%' }}>
                          {result.status === '成功' ? 
                            <CheckCircleOutlined style={{ color: '#51cf66' }} /> : 
                            <CloseCircleOutlined style={{ color: '#ff6b6b' }} />
                          }
                          <Text style={{ color: '#fff', flex: 1 }}>{result.topic}</Text>
                          {result.file_url && (
                            <Button 
                              type="link" 
                              href={`${API_BASE_URL}${result.file_url}`} 
                              target="_blank"
                              style={{ color: '#667eea', padding: 0 }}
                            >
                              下载
                            </Button>
                          )}
                        </div>
                      </List.Item>
                    )}
                  />
                </Card>
              )}
            </div>
          )}
        </div>
      </Content>
      <Footer style={{ 
        textAlign: 'center', 
        background: 'transparent', 
        color: 'rgba(255,255,255,0.3)',
        padding: '24px 50px'
      }}>
        相城中专教案生成系统 ©{new Date().getFullYear()}
      </Footer>
    </Layout>
  );
}

export default App;
