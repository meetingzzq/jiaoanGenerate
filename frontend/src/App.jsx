import React, { useState, useEffect, useRef } from 'react';
import { Layout, Form, Input, Button, Card, List, Typography, notification, message, Space, Badge, Tooltip, Collapse, Upload, Tag } from 'antd';
import { UploadOutlined, FileOutlined, DeleteOutlined } from '@ant-design/icons';
import axios from 'axios';
import './App.css';

const { Header, Content, Footer } = Layout;
const { Title, Text, Paragraph } = Typography;

const { Panel } = Collapse;
const { TextArea } = Input;

function App() {
  // 固定信息
  const [fixedInfo, setFixedInfo] = useState({
    院系: '智能装备学院',
    授课班级: '电气自动化（2）班',
    专业名称: '电气自动化',
    课程名称: '电子焊接',
    授课教师: '张老师',
    课程描述: ''
  });

  // 课时列表
  const [lessons, setLessons] = useState([
    {
      id: 1,
      课题名称: '电子元器件认识',
      授课地点: '电子实训室',
      授课时间: '2026年2月15日',
      授课学时: '2学时',
      授课类型: '理论课',
      用户描述: '',
      documents: []
    },
    {
      id: 2,
      课题名称: '焊接5步法',
      授课地点: '焊接实训室',
      授课时间: '2026年2月16日',
      授课学时: '3学时',
      授课类型: '理实一体化',
      用户描述: '',
      documents: []
    }
  ]);

  // 每个课时的上传文档 {lessonId: [documents]}
  const [lessonDocuments, setLessonDocuments] = useState({});

  // DeepSeek API Key
  const [apiKey, setApiKey] = useState(localStorage.getItem('deepseek_api_key') || '');

  // 生成状态
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationResults, setGenerationResults] = useState([]);
  const [progress, setProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [generationLogs, setGenerationLogs] = useState([]);
  const [animationKey, setAnimationKey] = useState(0);
  const [currentLessonIndex, setCurrentLessonIndex] = useState(0);
  const [lessonDetails, setLessonDetails] = useState({});
  
  // SSE日志相关
  const [backendLogs, setBackendLogs] = useState([]);
  const [isLogConnected, setIsLogConnected] = useState(false);
  const eventSourceRef = useRef(null);
  const sessionIdRef = useRef(null);
  const logsEndRef = useRef(null);

  // 生成唯一的session ID
  const generateSessionId = () => {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  };

  // 连接SSE日志流
  const connectLogStream = (sessionId) => {
    // 关闭之前的连接
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }
    
    sessionIdRef.current = sessionId;
    const eventSource = new EventSource(`/api/logs/${sessionId}`);
    
    eventSource.onopen = () => {
      setIsLogConnected(true);
      console.log('日志流连接已建立');
    };
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'log') {
          setBackendLogs(prev => [...prev, data.data]);
        } else if (data.type === 'connected') {
          console.log(data.message);
        }
        // heartbeat类型不处理，用于保持连接
      } catch (error) {
        console.error('解析日志消息失败:', error);
      }
    };
    
    eventSource.onerror = (error) => {
      console.error('日志流连接错误:', error);
      setIsLogConnected(false);
    };
    
    eventSourceRef.current = eventSource;
  };

  // 断开SSE日志流
  const disconnectLogStream = () => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsLogConnected(false);
  };

  // 自动滚动到底部
  useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [backendLogs]);

  // 组件卸载时关闭连接
  useEffect(() => {
    return () => {
      disconnectLogStream();
    };
  }, []);

  // 页面加载时重置生成状态（防止刷新后卡在生成中）
  useEffect(() => {
    // 清除之前的状态，防止刷新后卡在生成中
    localStorage.removeItem('lessonPlanGenerationState');
    setIsGenerating(false);
    setProgress(0);
    setCurrentStep(0);
    setGenerationLogs([]);
    setCurrentLessonIndex(0);
    setLessonDetails({});
    setBackendLogs([]);
  }, []);

  // 添加课时
  const addLesson = () => {
    const newId = lessons.length + 1;
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

  // 删除课时
  const removeLesson = (id) => {
    if (lessons.length > 1) {
      setLessons(lessons.filter(lesson => lesson.id !== id));
      message.success('课时删除成功');
    } else {
      message.warning('至少需要保留一个课时');
    }
  };

  // 更新课时信息
  const updateLesson = (id, field, value) => {
    setLessons(lessons.map(lesson =>
      lesson.id === id ? { ...lesson, [field]: value } : lesson
    ));
  };

  // 保存API Key到localStorage
  const handleApiKeyChange = (e) => {
    const newKey = e.target.value;
    setApiKey(newKey);
    localStorage.setItem('deepseek_api_key', newKey);
  };

  // 处理文档上传
  const handleDocumentUpload = async (lessonId, file) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('lesson_id', lessonId.toString());

    try {
      const response = await axios.post('/api/upload-document', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });

      if (response.data.success) {
        // 更新文档列表
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
      message.error(error.response?.data?.message || '上传文档失败，请检查网络连接');
      return false;
    }
  };

  // 删除文档
  const handleDeleteDocument = async (lessonId, filename) => {
    try {
      const response = await axios.delete(`/api/documents/${lessonId}/${filename}`);

      if (response.data.success) {
        // 更新文档列表
        setLessonDocuments(prev => ({
          ...prev,
          [lessonId]: (prev[lessonId] || []).filter(doc => doc.filename !== filename)
        }));
        message.success('文档删除成功');
        return true;
      } else {
        message.error(response.data.message || '删除失败');
        return false;
      }
    } catch (error) {
      console.error('删除文档失败:', error);
      message.error('删除文档失败');
      return false;
    }
  };

  // 格式化文件大小
  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // 生成教案
  const generateLessonPlans = async () => {
    // 验证API Key
    if (!apiKey || apiKey.trim() === '') {
      notification.error({
        message: '🔑 API Key 未填写',
        description: '请输入您的 DeepSeek API Key 才能生成教案',
        duration: 3
      });
      return;
    }

    // 验证表单
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

    // 重置状态
    setIsGenerating(true);
    setProgress(0);
    setCurrentStep(0);
    setGenerationLogs([]);
    setGenerationResults([]);
    setCurrentLessonIndex(0);
    setLessonDetails({});
    setBackendLogs([]);
    setAnimationKey(prev => prev + 1);
    
    // 生成新的session ID并连接日志流
    const sessionId = generateSessionId();
    connectLogStream(sessionId);

    try {
      // 记录开始
      setGenerationLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message: '开始生成教案...' }]);
      setCurrentStep(1);

      // 逐个生成教案
      for (let i = 0; i < lessons.length; i++) {
        const lesson = lessons[i];
        const currentLessonNum = i + 1;
        
        // 更新进度
        setProgress((currentLessonNum / lessons.length) * 100);
        setCurrentStep(Math.min(Math.floor((currentLessonNum / lessons.length) * 3), 3));
        setCurrentLessonIndex(currentLessonNum);

        // 记录开始生成当前课时
        const lessonLogId = `${currentLessonNum}_${Date.now()}`;
        setLessonDetails(prev => ({
          ...prev,
          [lessonLogId]: {
            topic: lesson.课题名称,
            logs: []
          }
        }));

        setGenerationLogs(prev => [...prev, { 
          time: new Date().toLocaleTimeString(), 
          message: `开始生成课时 ${currentLessonNum}: ${lesson.课题名称}`,
          lessonId: currentLessonNum,
          logId: lessonLogId
        }]);

        // 模拟详细生成步骤
        const stepLogs = [
          { message: '准备生成参数...', step: 1 },
          { message: '分析课程信息...', step: 1 },
          { message: '调用大模型生成内容...', step: 2 },
          { message: '解析模型返回数据...', step: 2 },
          { message: '填充Word文档模板...', step: 3 },
          { message: '保存教案文件...', step: 3 }
        ];

        // 发送单个教案生成请求
        try {
          // 模拟步骤日志
          for (const stepLog of stepLogs) {
            setLessonDetails(prev => ({
              ...prev,
              [lessonLogId]: {
                ...prev[lessonLogId],
                logs: [...(prev[lessonLogId]?.logs || []), {
                  time: new Date().toLocaleTimeString(),
                  message: stepLog.message
                }]
              }
            }));
            setCurrentStep(stepLog.step);
            await new Promise(resolve => setTimeout(resolve, 500));
          }

          // 获取当前课时的文档
          const currentLessonDocs = lessonDocuments[lesson.id] || [];
          
          // 发送实际请求，带上session ID、当前课时的文档和API Key
          const response = await axios.post('/api/generate', {
            fixed_course_info: fixedInfo,
            variable_course_info: {
              ...lesson,
              documents: currentLessonDocs
            },
            lesson_index: currentLessonNum,
            api_key: apiKey
          }, {
            headers: {
              'X-Session-ID': sessionId
            }
          });

          if (response.data.success) {
            // 添加到结果列表
            setGenerationResults(prev => [...prev, response.data.result]);
            setGenerationLogs(prev => [...prev, { 
              time: new Date().toLocaleTimeString(), 
              message: `课时 ${currentLessonNum} 生成成功！`,
              lessonId: currentLessonNum,
              logId: lessonLogId
            }]);
            
            // 更新课时详情
            setLessonDetails(prev => ({
              ...prev,
              [lessonLogId]: {
                ...prev[lessonLogId],
                status: '成功',
                fileUrl: response.data.result.file_url
              }
            }));
            
            // 显示成功通知
            notification.success({ 
              message: `课时 ${currentLessonNum} 生成成功`,
              description: `《${lesson.课题名称}》已生成，可立即下载`,
              duration: 2
            });
          } else if (response.data.error_type === 'invalid_api_key') {
            // API Key无效，停止生成
            setIsGenerating(false);
            disconnectLogStream();
            
            notification.error({
              message: '🔑 API Key 无效',
              description: (
                <div style={{ padding: '10px 0' }}>
                  <p style={{ marginBottom: '8px', fontSize: '14px' }}>DeepSeek API Key 无效或已过期，请检查您的 API Key 是否正确。</p>
                  <p style={{ marginBottom: '0', fontSize: '13px', color: '#666' }}>您可以：</p>
                  <ul style={{ margin: '4px 0', paddingLeft: '20px', fontSize: '13px', color: '#666' }}>
                    <li>检查 API Key 是否输入正确</li>
                    <li>在 DeepSeek 官网重新获取 API Key</li>
                    <li>留空使用系统默认 Key</li>
                  </ul>
                </div>
              ),
              duration: 0,
              placement: 'top',
              style: {
                borderRadius: '12px',
                boxShadow: '0 8px 32px rgba(255, 138, 128, 0.2)'
              }
            });
            
            return; // 停止后续生成
          } else {
            // 添加失败结果
            const errorResult = {
              topic: lesson.课题名称,
              status: '失败',
              message: response.data.message
            };
            setGenerationResults(prev => [...prev, errorResult]);
            setGenerationLogs(prev => [...prev, { 
              time: new Date().toLocaleTimeString(), 
              message: `课时 ${currentLessonNum} 生成失败: ${response.data.message}`,
              lessonId: currentLessonNum,
              logId: lessonLogId
            }]);
            
            // 更新课时详情
            setLessonDetails(prev => ({
              ...prev,
              [lessonLogId]: {
                ...prev[lessonLogId],
                status: '失败',
                error: response.data.message
              }
            }));
            
            // 显示失败通知
            notification.error({ 
              message: `课时 ${currentLessonNum} 生成失败`,
              description: response.data.message,
              duration: 2
            });
          }
        } catch (error) {
          // 添加失败结果
          const errorResult = {
            topic: lesson.课题名称,
            status: '失败',
            message: error.message
          };
          setGenerationResults(prev => [...prev, errorResult]);
          setGenerationLogs(prev => [...prev, { 
            time: new Date().toLocaleTimeString(), 
            message: `课时 ${currentLessonNum} 生成失败: ${error.message}`,
            lessonId: currentLessonNum,
            logId: lessonLogId
          }]);
          
          // 更新课时详情
          setLessonDetails(prev => ({
            ...prev,
            [lessonLogId]: {
              ...prev[lessonLogId],
              status: '失败',
              error: error.message
            }
          }));
          
          // 显示失败通知
          notification.error({ 
            message: `课时 ${currentLessonNum} 生成失败`,
            description: '请检查后端服务是否运行',
            duration: 2
          });
        }
      }

      // 完成所有生成
      setProgress(100);
      setCurrentStep(3);
      setGenerationLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message: '所有教案生成完成！' }]);
      
      // 显示总体结果
      const successCount = generationResults.filter(r => r.status === '成功').length;
      notification.success({ 
        message: '批量生成完成',
        description: `成功生成 ${successCount} 个教案，失败 ${lessons.length - successCount} 个`,
        duration: 3
      });
    } catch (error) {
      setGenerationLogs(prev => [...prev, { time: new Date().toLocaleTimeString(), message: `批量生成失败: ${error.message}` }]);
      console.error('批量生成失败:', error);
      notification.error({ 
        message: '批量生成失败',
        description: '请检查后端服务是否运行',
        duration: 3
      });
    } finally {
      setIsGenerating(false);
      // 延迟断开日志连接，让用户能看到最后的日志
      setTimeout(() => {
        disconnectLogStream();
      }, 3000);
    }
  };

  return (
    <Layout className="layout">
      {/* 浮动装饰元素 */}
      <div className="floating-decoration">🌸</div>
      <div className="floating-decoration">🍃</div>
      <div className="floating-decoration">✨</div>
      <div className="floating-decoration">🌿</div>
      
      <Header className="header">
        <div className="header-content">
          <div className="header-icon">🎐</div>
          <div className="header-title-wrapper">
            <Title level={3} className="header-title">
              相城中专教案生成系统
            </Title>
            <span className="header-author">作者：祝志强</span>
          </div>
          <div className="header-decoration">
            <span className="cloud">☁️</span>
            <span className="star">✨</span>
          </div>
        </div>
        <div className="header-actions">
          <Button 
            type="primary" 
            onClick={generateLessonPlans} 
            loading={isGenerating}
            size="large"
            className="generate-button"
          >
            {isGenerating ? '生成中...' : '🌸 批量生成教案'}
          </Button>
        </div>
      </Header>

      <Content className="main-content">
        <div className="card-container">
        {/* 固定信息卡片 */}
        <Card 
          title={<span className="card-title">📚 固定课程信息</span>}
          className="info-card ghibli-card"
        >
          <Form layout="vertical">
            <div className="form-row">
              <Form.Item label="院系" className="ghibli-form-item form-col-3">
                <Input 
                  value={fixedInfo.院系} 
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 院系: e.target.value })} 
                  className="ghibli-input"
                />
              </Form.Item>
              <Form.Item label="授课班级" className="ghibli-form-item form-col-3">
                <Input 
                  value={fixedInfo.授课班级} 
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 授课班级: e.target.value })} 
                  className="ghibli-input"
                />
              </Form.Item>
              <Form.Item label="专业名称" className="ghibli-form-item form-col-3">
                <Input 
                  value={fixedInfo.专业名称} 
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 专业名称: e.target.value })} 
                  className="ghibli-input"
                />
              </Form.Item>
            </div>
            <div className="form-row">
              <Form.Item label="课程名称" className="ghibli-form-item form-col-2">
                <Input 
                  value={fixedInfo.课程名称} 
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 课程名称: e.target.value })} 
                  className="ghibli-input"
                />
              </Form.Item>
              <Form.Item label="授课教师" className="ghibli-form-item form-col-2">
                <Input 
                  value={fixedInfo.授课教师} 
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 授课教师: e.target.value })} 
                  className="ghibli-input"
                />
              </Form.Item>
            </div>
            <div className="form-row">
              <Form.Item
                label={<span className="description-label">📋 课程描述 <span className="description-hint">（选填：描述整个课程的目标、特点、学生情况等，对所有教案生效）</span></span>}
                className="ghibli-form-item form-col-full"
              >
                <TextArea
                  value={fixedInfo.课程描述}
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 课程描述: e.target.value })}
                  className="ghibli-textarea"
                  placeholder="例如：本课程是电气自动化专业的核心课程，主要培养学生的电子焊接技能。学生已具备基础电路理论知识，但缺乏实际操作经验。课程注重理论与实践相结合..."
                  rows={3}
                  showCount
                  maxLength={2000}
                />
              </Form.Item>
            </div>
            <div className="form-row">
              <Form.Item 
                label={<span className="api-key-label required">🔑 DeepSeek API Key <span className="api-key-hint">（必填：请输入您的DeepSeek API Key）</span></span>} 
                className="ghibli-form-item form-col-full"
                required
              >
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

        {/* 课时列表卡片 */}
        <Card 
          title={<span className="card-title">📝 课时信息</span>}
          extra={
            <Button type="dashed" onClick={addLesson} className="add-lesson-button ghibli-button">
              <span className="button-icon">➕</span> 添加课时
            </Button>
          }
          className="info-card ghibli-card"
        >
          <List
            dataSource={lessons}
            renderItem={(lesson) => (
              <List.Item
                key={lesson.id}
                className="lesson-item"
                actions={[
                  <Tooltip title="删除课时">
                    <Button 
                      danger 
                      size="small" 
                      onClick={() => removeLesson(lesson.id)}
                      className="delete-button"
                    >
                      🗑️
                    </Button>
                  </Tooltip>
                ]}
              >
                <Card 
                  size="small" 
                  title={<span className="lesson-card-title">📖 课时 {lesson.id}</span>}
                  className="lesson-card ghibli-inner-card"
                >
                  <Form layout="vertical">
                    <div className="form-row">
                      <Form.Item label="课题名称" className="ghibli-form-item form-col-2">
                        <Input 
                          value={lesson.课题名称} 
                          onChange={(e) => updateLesson(lesson.id, '课题名称', e.target.value)} 
                          className="ghibli-input"
                          placeholder="请输入课题名称"
                        />
                      </Form.Item>
                      <Form.Item label="授课地点" className="ghibli-form-item form-col-2">
                        <Input 
                          value={lesson.授课地点} 
                          onChange={(e) => updateLesson(lesson.id, '授课地点', e.target.value)} 
                          className="ghibli-input"
                          placeholder="请输入授课地点"
                        />
                      </Form.Item>
                    </div>
                    <div className="form-row">
                      <Form.Item label="授课时间" className="ghibli-form-item form-col-3">
                        <Input 
                          value={lesson.授课时间} 
                          onChange={(e) => updateLesson(lesson.id, '授课时间', e.target.value)} 
                          className="ghibli-input"
                          placeholder="请输入授课时间"
                        />
                      </Form.Item>
                      <Form.Item label="授课学时" className="ghibli-form-item form-col-3">
                        <Input 
                          value={lesson.授课学时} 
                          onChange={(e) => updateLesson(lesson.id, '授课学时', e.target.value)} 
                          className="ghibli-input"
                          placeholder="如：2学时"
                        />
                      </Form.Item>
                      <Form.Item label="授课类型" className="ghibli-form-item form-col-3">
                        <Input 
                          value={lesson.授课类型} 
                          onChange={(e) => updateLesson(lesson.id, '授课类型', e.target.value)} 
                          className="ghibli-input"
                          placeholder="理论课/理实一体化"
                        />
                      </Form.Item>
                    </div>
                    <Form.Item
                      label={<span className="description-label">💭 本节课描述 <span className="description-hint">（选填：描述上课内容、想法，让AI生成更贴近您需求的教案）</span></span>}
                      className="ghibli-form-item description-item"
                    >
                      <TextArea
                        value={lesson.用户描述}
                        onChange={(e) => updateLesson(lesson.id, '用户描述', e.target.value)}
                        className="ghibli-textarea"
                        placeholder="例如：本节课主要讲解电阻、电容、二极管等基础电子元器件的识别与检测方法。学生已经学过基础电路知识，但对实物元器件接触较少..."
                        rows={4}
                        showCount
                        maxLength={1000}
                      />
                    </Form.Item>

                    {/* 文档上传区域 */}
                    <Form.Item
                      label={<span className="description-label">📎 参考文档 <span className="description-hint">（选填：上传教学大纲、课件等文档，AI将参考内容生成教案）</span></span>}
                      className="ghibli-form-item document-item"
                    >
                      <div className="document-upload-section">
                        {/* 已上传文档列表 */}
                        {lessonDocuments[lesson.id] && lessonDocuments[lesson.id].length > 0 && (
                          <div className="uploaded-documents-list">
                            {lessonDocuments[lesson.id].map((doc, index) => (
                              <div key={index} className="document-item">
                                <div className="document-info">
                                  <FileOutlined className="document-icon" />
                                  <div className="document-details">
                                    <Text className="document-name" title={doc.filename}>
                                      {doc.filename}
                                    </Text>
                                    <Text type="secondary" className="document-meta">
                                      {formatFileSize(doc.file_size)} · {doc.upload_time}
                                    </Text>
                                  </div>
                                </div>
                                <Tooltip title="删除文档">
                                  <Button
                                    type="text"
                                    danger
                                    size="small"
                                    icon={<DeleteOutlined />}
                                    onClick={() => handleDeleteDocument(lesson.id, doc.filename)}
                                    className="document-delete-btn"
                                  />
                                </Tooltip>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 上传按钮 */}
                        <Upload
                          beforeUpload={(file) => {
                            // 检查文件扩展名
                            const allowedExtensions = ['.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls', '.txt', '.pdf'];
                            const fileExt = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
                            if (!allowedExtensions.includes(fileExt)) {
                              message.error(`不支持的文件格式 "${fileExt}"。请上传以下格式的文件：Word(.doc/.docx)、PPT(.ppt/.pptx)、Excel(.xls/.xlsx)、TXT(.txt)、PDF(.pdf)`);
                              return false;
                            }
                            handleDocumentUpload(lesson.id, file);
                            return false; // 阻止自动上传，使用自定义上传
                          }}
                          showUploadList={false}
                          accept=".docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.pdf"
                        >
                          <Button
                            icon={<UploadOutlined />}
                            className="upload-document-btn ghibli-button"
                            disabled={lessonDocuments[lesson.id]?.length >= 3}
                          >
                            {lessonDocuments[lesson.id]?.length >= 3 ? '最多3个文档' : '上传文档'}
                          </Button>
                        </Upload>
                        <div className="upload-hint-container">
                          <Text type="secondary" className="upload-hint">
                            支持格式：Word(.doc/.docx)、PPT(.ppt/.pptx)、Excel(.xls/.xlsx)、TXT(.txt)、PDF(.pdf)
                          </Text>
                          <Text type="secondary" className="upload-hint upload-hint-limit">
                            最多3个文档，单个文件不超过10MB
                          </Text>
                        </div>
                      </div>
                    </Form.Item>
                  </Form>
                </Card>
              </List.Item>
            )}
          />
        </Card>

        {/* 生成进度 */}
        {(isGenerating || generationResults.length > 0) && (
          <Card 
            title={<span className="card-title">{isGenerating ? '🌟 生成进度' : '✨ 生成结果详情'}</span>}
            className="progress-card ghibli-card"
          >
            <div className="progress-container">
              {isGenerating && (
                <div className="current-lesson-info">
                  <Text strong className="info-label">当前生成: </Text>
                  <Text className="info-value">{currentLessonIndex > 0 ? `课时 ${currentLessonIndex}` : '准备中...'}</Text>
                  {currentLessonIndex > 0 && (
                    <Text className="info-topic">{lessons[currentLessonIndex - 1]?.课题名称}</Text>
                  )}
                </div>
              )}
              
              {/* 后端实时日志 */}
              {(isGenerating || backendLogs.length > 0) && (
                <div className="backend-logs-container">
                  <div className="backend-logs-header">
                    <Title level={5} className="section-title">🔧 后端生成日志</Title>
                    {isLogConnected && (
                      <span className="log-connection-status connected">
                        <span className="status-dot"></span>
                        实时连接中
                      </span>
                    )}
                  </div>
                  <div className="backend-logs-list">
                    {backendLogs.map((log, index) => (
                      <div key={index} className="backend-log-item">
                        <Text type="secondary" className="log-time">[{log.time}]</Text>
                        <Text className="log-message backend-log-message">{log.message}</Text>
                      </div>
                    ))}
                    {isGenerating && (
                      <div className="backend-log-item loading">
                        <Text type="secondary" className="log-time">[{new Date().toLocaleTimeString()}]</Text>
                        <Text className="log-message">等待后端响应...</Text>
                      </div>
                    )}
                    <div ref={logsEndRef} />
                  </div>
                </div>
              )}
              
            </div>
          </Card>
        )}

        {/* 生成结果 */}
        {generationResults.length > 0 && (
          <Card 
            title={<span className="card-title">🎉 生成结果</span>}
            className="results-card ghibli-card"
          >
            <List
              dataSource={generationResults}
              renderItem={(result, index) => (
                <List.Item key={index} className="result-item">
                  <div className="result-content">
                    <Space size="middle">
                      <Badge 
                        status={result.status === '成功' ? 'success' : 'error'} 
                        text={result.status}
                        className="result-badge"
                      />
                      <Text strong className="result-topic">{result.topic}</Text>
                      {result.file_url && (
                        <Button 
                          type="link" 
                          href={result.file_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="download-button"
                        >
                          📥 下载教案
                        </Button>
                      )}
                    </Space>
                    {result.message && (
                      <Paragraph className="result-message">
                        {result.message}
                      </Paragraph>
                    )}
                  </div>
                </List.Item>
              )}
            />
          </Card>
        )}
        </div>
      </Content>

      <Footer className="ghibli-footer">
        <div className="footer-content">
          <span className="footer-icon">🌿</span>
          <Text type="secondary" className="footer-text">
            教案自动生成系统 ©{new Date().getFullYear()} · 让教学更从容
          </Text>
          <span className="footer-icon">🍃</span>
        </div>
      </Footer>
    </Layout>
  );
}

export default App;
