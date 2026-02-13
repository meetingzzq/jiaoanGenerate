"""
工具模块 - 存放通用工具函数
"""
import re
import json


def markdown_to_plain_text(markdown_text: str) -> str:
    """
    将Markdown格式转换为纯文本
    移除markdown标记（**、*、#、- 等），保留纯文本内容
    """
    if not markdown_text:
        return ""
    
    text = markdown_text
    
    # 移除标题标记 (# ## ###)
    text = re.sub(r'^#{1,6}\s*', '', text, flags=re.MULTILINE)
    
    # 移除粗体标记 (**text**)
    text = re.sub(r'\*\*(.*?)\*\*', r'\1', text)
    
    # 移除斜体标记 (*text* 或 _text_)
    text = re.sub(r'\*(.*?)\*', r'\1', text)
    text = re.sub(r'_(.*?)_', r'\1', text)
    
    # 移除行内代码标记 (`text`)
    text = re.sub(r'`(.*?)`', r'\1', text)
    
    # 移除代码块标记 (```)
    text = re.sub(r'```[\s\S]*?```', '', text)
    
    # 移除链接标记 [text](url) -> text
    text = re.sub(r'\[(.*?)\]\(.*?\)', r'\1', text)
    
    # 移除图片标记 ![alt](url)
    text = re.sub(r'!\[(.*?)\]\(.*?\)', r'\1', text)
    
    # 移除列表标记 (- 或 * 或 数字.)
    text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*\d+\.\s+', '', text, flags=re.MULTILINE)
    
    # 移除水平分割线 (--- 或 *** 或 ___)
    text = re.sub(r'^[\-\*_]{3,}\s*$', '', text, flags=re.MULTILINE)
    
    # 移除引用标记 (>)
    text = re.sub(r'^\s*>\s*', '', text, flags=re.MULTILINE)
    
    # 移除多余的空行（保留一个）
    text = re.sub(r'\n{3,}', '\n\n', text)
    
    # 去除首尾空白
    text = text.strip()
    
    return text


def parse_lesson_plan_json(content: str) -> dict:
    """
    解析大模型返回的JSON内容
    处理可能的格式问题（如markdown代码块、多余字符等）
    """
    # 移除markdown代码块标记
    content = re.sub(r'^```json\s*', '', content, flags=re.MULTILINE)
    content = re.sub(r'^```\s*', '', content, flags=re.MULTILINE)
    content = re.sub(r'```\s*$', '', content, flags=re.MULTILINE)
    
    # 去除首尾空白
    content = content.strip()
    
    # 尝试解析JSON
    try:
        data = json.loads(content)
        return data
    except json.JSONDecodeError as e:
        print(f"     ⚠️ JSON解析失败，尝试修复...")
        # 尝试找到JSON的起始和结束位置
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            try:
                data = json.loads(json_match.group())
                return data
            except:
                pass
        raise e


def format_analysis_text(content_analysis: dict) -> str:
    """格式化教学内容及学情分析文本"""
    return f"【教学内容】\n{content_analysis.get('教学内容', '')}\n\n【学情分析】\n{content_analysis.get('学情分析', '')}"


def format_objectives_text(objectives: dict) -> str:
    """格式化教学目标文本"""
    return (
        f"1. 知识目标：{objectives.get('知识目标', '')}\n"
        f"2. 能力目标：{objectives.get('能力目标', '')}\n"
        f"3. 素质目标：{objectives.get('素质目标', '')}"
    )


def format_list_text(items: list) -> str:
    """格式化列表文本（教学重点、教学难点、思政元素）"""
    return "\n".join([f"{i+1}. {point}" for i, point in enumerate(items)])


def format_methods_text(methods_resources: dict) -> str:
    """格式化教学方法与教学资源文本"""
    return (
        f"【教学方法】\n{methods_resources.get('教学方法', '')}\n\n"
        f"【教学资源】\n{methods_resources.get('教学资源', '')}"
    )


def format_homework_text(homework: dict) -> str:
    """格式化课外作业文本"""
    return (
        f"1. 基础题：{homework.get('基础题', '')}\n"
        f"2. 提升题：{homework.get('提升题', '')}\n"
        f"3. 预习：{homework.get('预习题', '')}"
    )
