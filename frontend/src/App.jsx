import React, { useState, useEffect, useRef, useCallback } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

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
  const [activeTab, setActiveTab] = useState('form');
  const [expandedLesson, setExpandedLesson] = useState(1);
  
  const logsEndRef = useRef(null);
  const pollIntervalRef = useRef(null);
  const lastLogIndexRef = useRef(0);
  const fileInputRef = useRef(null);
  const currentUploadLessonId = useRef(null);

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
    const newLesson = {
      id: newId,
      课题名称: `课时${newId}`,
      授课地点: '',
      授课时间: '',
      授课学时: '1学时',
      授课类型: '理论课',
      用户描述: ''
    };
    setLessons([...lessons, newLesson]);
    setExpandedLesson(newId);
  };

  const removeLesson = (id) => {
    if (lessons.length > 1) {
      setLessons(lessons.filter(lesson => lesson.id !== id));
      const newDocs = { ...lessonDocuments };
      delete newDocs[id];
      setLessonDocuments(newDocs);
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
        return true;
      } else {
        alert(response.data.message || '上传失败');
        return false;
      }
    } catch (error) {
      console.error('上传文档失败:', error);
      alert(error.response?.data?.message || '上传文档失败');
      return false;
    } finally {
      setUploadingFiles(prev => {
        const newState = { ...prev };
        delete newState[uploadKey];
        return newState;
      });
    }
  };

  const handleDeleteDocument = (lessonId, filename) => {
    setLessonDocuments(prev => ({
      ...prev,
      [lessonId]: (prev[lessonId] || []).filter(doc => doc.filename !== filename)
    }));
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const triggerFileUpload = (lessonId) => {
    currentUploadLessonId.current = lessonId;
    fileInputRef.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && currentUploadLessonId.current) {
      handleDocumentUpload(currentUploadLessonId.current, file);
    }
    e.target.value = '';
  };

  const generateLessonPlans = async () => {
    if (!apiKey || apiKey.trim() === '') {
      alert('请输入您的 DeepSeek API Key');
      return;
    }

    const hasEmptyFields = lessons.some(lesson => 
      !lesson.课题名称 || !lesson.授课地点 || !lesson.授课时间 || !lesson.授课学时 || !lesson.授课类型
    );

    if (hasEmptyFields) {
      alert('请填写所有课时的必填字段');
      return;
    }

    setIsGenerating(true);
    setGenerationResults([]);
    setBackendLogs([]);
    lastLogIndexRef.current = 0;
    setActiveTab('logs');

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
        setActiveTab('results');
      } else if (response.data.error_type === 'invalid_api_key') {
        alert('DeepSeek API Key 无效或已过期');
      } else {
        alert(response.data.message || '生成失败');
      }
    } catch (error) {
      console.error('批量生成失败:', error);
      alert(error.response?.data?.message || '请检查后端服务');
    } finally {
      setIsGenerating(false);
      stopPolling();
    }
  };

  const downloadFile = (fileUrl, fileName) => {
    const link = document.createElement('a');
    link.href = `${API_BASE_URL}${fileUrl}`;
    link.download = fileName;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getLogStyle = (msg) => {
    if (!msg) return { color: '#86868b' };
    if (msg.includes('失败') || msg.includes('错误') || msg.includes('Error') || msg.includes('error')) {
      return { color: '#ff3b30' };
    }
    if (msg.includes('成功') || msg.includes('完成')) {
      return { color: '#34c759' };
    }
    if (msg.includes('开始') || msg.includes('正在')) {
      return { color: '#007aff' };
    }
    return { color: '#86868b' };
  };

  return (
    <div className="app-container">
      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        accept=".docx,.doc,.pptx,.ppt,.xlsx,.xls,.txt,.pdf"
        onChange={handleFileChange}
      />
      
      <header className="app-header">
        <div className="header-content">
          <div className="logo-section">
            <div className="logo-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
            <div className="logo-text">
              <h1>教案生成系统</h1>
              <p>相城中专 · 祝志强</p>
            </div>
          </div>
          
          <button 
            className={`generate-btn ${isGenerating ? 'generating' : ''}`}
            onClick={generateLessonPlans}
            disabled={isGenerating}
          >
            {isGenerating ? (
              <>
                <span className="spinner"></span>
                生成中...
              </>
            ) : (
              <>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                </svg>
                批量生成教案
              </>
            )}
          </button>
        </div>
      </header>

      <main className="main-content">
        <div className="content-wrapper">
          <section className="fixed-info-section">
            <div className="section-header">
              <h2>课程基本信息</h2>
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label>院系</label>
                <input
                  type="text"
                  value={fixedInfo.院系}
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 院系: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>授课班级</label>
                <input
                  type="text"
                  value={fixedInfo.授课班级}
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 授课班级: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>专业名称</label>
                <input
                  type="text"
                  value={fixedInfo.专业名称}
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 专业名称: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>课程名称</label>
                <input
                  type="text"
                  value={fixedInfo.课程名称}
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 课程名称: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>授课教师</label>
                <input
                  type="text"
                  value={fixedInfo.授课教师}
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 授课教师: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>课程描述 <span className="optional">选填</span></label>
                <input
                  type="text"
                  value={fixedInfo.课程描述}
                  onChange={(e) => setFixedInfo({ ...fixedInfo, 课程描述: e.target.value })}
                  placeholder="描述整个课程的目标、特点..."
                />
              </div>
            </div>
            <div className="api-key-section">
              <label>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
                </svg>
                DeepSeek API Key
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={handleApiKeyChange}
                placeholder="请输入您的 API Key"
              />
            </div>
          </section>

          <section className="lessons-section">
            <div className="section-header">
              <h2>课时信息</h2>
              <span className="badge">{lessons.length}</span>
              <button className="add-lesson-btn" onClick={addLesson}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                添加课时
              </button>
            </div>

            <div className="lessons-list">
              {lessons.map((lesson) => (
                <div 
                  key={lesson.id} 
                  className={`lesson-card ${expandedLesson === lesson.id ? 'expanded' : ''}`}
                >
                  <div 
                    className="lesson-header"
                    onClick={() => setExpandedLesson(expandedLesson === lesson.id ? null : lesson.id)}
                  >
                    <div className="lesson-title">
                      <span className="lesson-number">{String(lesson.id).padStart(2, '0')}</span>
                      <span className="lesson-name">{lesson.课题名称}</span>
                    </div>
                    <div className="lesson-actions">
                      {lessons.length > 1 && (
                        <button 
                          className="delete-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeLesson(lesson.id);
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      )}
                      <span className="expand-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </span>
                    </div>
                  </div>
                  
                  {expandedLesson === lesson.id && (
                    <div className="lesson-content">
                      <div className="form-grid small">
                        <div className="form-group">
                          <label>课题名称</label>
                          <input
                            type="text"
                            value={lesson.课题名称}
                            onChange={(e) => updateLesson(lesson.id, '课题名称', e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>授课地点</label>
                          <input
                            type="text"
                            value={lesson.授课地点}
                            onChange={(e) => updateLesson(lesson.id, '授课地点', e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>授课时间</label>
                          <input
                            type="text"
                            value={lesson.授课时间}
                            onChange={(e) => updateLesson(lesson.id, '授课时间', e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>授课学时</label>
                          <input
                            type="text"
                            value={lesson.授课学时}
                            onChange={(e) => updateLesson(lesson.id, '授课学时', e.target.value)}
                          />
                        </div>
                        <div className="form-group">
                          <label>授课类型</label>
                          <input
                            type="text"
                            value={lesson.授课类型}
                            onChange={(e) => updateLesson(lesson.id, '授课类型', e.target.value)}
                          />
                        </div>
                      </div>
                      
                      <div className="form-group full-width">
                        <label>本节课描述 <span className="optional">选填</span></label>
                        <textarea
                          value={lesson.用户描述}
                          onChange={(e) => updateLesson(lesson.id, '用户描述', e.target.value)}
                          placeholder="描述上课内容、想法..."
                          rows={2}
                        />
                      </div>

                      <div className="documents-section">
                        <label>参考文档 <span className="optional">选填</span></label>
                        <div className="documents-list">
                          {lessonDocuments[lesson.id]?.map((doc, index) => (
                            <div key={index} className="document-item">
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                              </svg>
                              <span className="doc-name">{doc.filename}</span>
                              <span className="doc-size">{formatFileSize(doc.file_size)}</span>
                              <button 
                                className="remove-doc-btn"
                                onClick={() => handleDeleteDocument(lesson.id, doc.filename)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <line x1="18" y1="6" x2="6" y2="18" />
                                  <line x1="6" y1="6" x2="18" y2="18" />
                                </svg>
                              </button>
                            </div>
                          ))}
                          
                          {Object.values(uploadingFiles).some(v => v) && (
                            <div className="uploading-indicator">
                              <span className="spinner small"></span>
                              上传中...
                            </div>
                          )}
                          
                          <button 
                            className="upload-btn"
                            onClick={() => triggerFileUpload(lesson.id)}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="17 8 12 3 7 8" />
                              <line x1="12" y1="3" x2="12" y2="15" />
                            </svg>
                            上传文档
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {(backendLogs.length > 0 || generationResults.length > 0 || isGenerating) && (
            <section className="status-section">
              <div className="tabs">
                <button 
                  className={`tab ${activeTab === 'logs' ? 'active' : ''}`}
                  onClick={() => setActiveTab('logs')}
                >
                  {isGenerating && <span className="spinner small"></span>}
                  实时日志
                  {backendLogs.length > 0 && <span className="tab-badge">{backendLogs.length}</span>}
                </button>
                <button 
                  className={`tab ${activeTab === 'results' ? 'active' : ''}`}
                  onClick={() => setActiveTab('results')}
                >
                  生成结果
                  {generationResults.length > 0 && <span className="tab-badge success">{generationResults.filter(r => r.status === '成功').length}</span>}
                </button>
              </div>

              <div className="tab-content">
                {activeTab === 'logs' && (
                  <div className="logs-panel">
                    {isGenerating && currentTopic && (
                      <div className="current-task">
                        <span className="spinner"></span>
                        正在生成: {currentTopic}
                      </div>
                    )}
                    <div className="logs-list">
                      {backendLogs.map((log, index) => (
                        <div key={index} className="log-item" style={getLogStyle(log.message)}>
                          <span className="log-time">[{log.time}]</span>
                          <span className="log-message">{log.message}</span>
                        </div>
                      ))}
                      <div ref={logsEndRef} />
                    </div>
                  </div>
                )}

                {activeTab === 'results' && (
                  <div className="results-panel">
                    {generationResults.length === 0 ? (
                      <div className="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="12" y1="18" x2="12" y2="12" />
                          <line x1="9" y1="15" x2="15" y2="15" />
                        </svg>
                        <p>暂无生成结果</p>
                      </div>
                    ) : (
                      <div className="results-list">
                        {generationResults.map((result, index) => (
                          <div key={index} className={`result-item ${result.status === '成功' ? 'success' : 'error'}`}>
                            <div className="result-icon">
                              {result.status === '成功' ? (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <circle cx="12" cy="12" r="10" />
                                  <line x1="15" y1="9" x2="9" y2="15" />
                                  <line x1="9" y1="9" x2="15" y2="15" />
                                </svg>
                              )}
                            </div>
                            <div className="result-info">
                              <span className="result-topic">{result.topic}</span>
                              <span className="result-status">{result.status}</span>
                            </div>
                            {result.file_url && (
                              <button 
                                className="download-btn"
                                onClick={() => downloadFile(result.file_url, result.file_name)}
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                  <polyline points="7 10 12 15 17 10" />
                                  <line x1="12" y1="15" x2="12" y2="3" />
                                </svg>
                                下载
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </main>

      <footer className="app-footer">
        <p>© {new Date().getFullYear()} 相城中专教案生成系统</p>
      </footer>
    </div>
  );
}

export default App;
