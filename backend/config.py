"""
配置文件 - 存放API密钥和其他配置
"""
import os
from dotenv import load_dotenv

# 加载环境变量
load_dotenv()

# DeepSeek API配置 - 默认空值，必须由用户提供
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")
DEEPSEEK_API_URL = os.getenv("DEEPSEEK_API_URL", "https://api.deepseek.com/v1/chat/completions")

# 模型参数
MODEL_CONFIG = {
    "model": "deepseek-chat",
    "temperature": 0.7,
    "max_tokens": 4000,
    "stream": False
}

# 固定课程信息（批量生成时不变）
DEFAULT_FIXED_COURSE_INFO = {
    "院系": "智能装备学院",
    "授课班级": "电气自动化（2）班",
    "专业名称": "电气自动化",
    "课程名称": "电子焊接",
    "授课教师": "张老师"
}

# 可变课程信息（每节课不同）
DEFAULT_VARIABLE_COURSE_INFO = {
    "课题名称": "焊接5步法",
    "授课地点": "焊接实训室",
    "授课时间": "2026年2月",
    "授课学时": "3学时",
    "授课类型": "理实一体化"
}

# 默认完整课程信息
DEFAULT_COURSE_INFO = {
    **DEFAULT_FIXED_COURSE_INFO,
    **DEFAULT_VARIABLE_COURSE_INFO
}
