"""
教案自动生成系统 - 主程序
整合各模块，提供完整的教案生成功能
"""
import os
import sys
import logging

logger = logging.getLogger('jiaoan')

from config import DEFAULT_COURSE_INFO, DEFAULT_FIXED_COURSE_INFO, DEFAULT_VARIABLE_COURSE_INFO
from ai_generator import generate_lesson_plan, get_mock_lesson_data
from docx_utils import LessonPlanDoc
from utils import (
    format_analysis_text,
    format_objectives_text,
    format_list_text,
    format_methods_text,
    format_homework_text
)


def print_header():
    logger.info("=" * 60)
    logger.info("🚀 教案自动生成系统")
    logger.info("=" * 60)


def print_course_info(course_info: dict):
    logger.info("📋 课程信息:")
    logger.info(f"   课题名称: {course_info.get('课题名称', '')}")
    logger.info(f"   授课班级: {course_info.get('授课班级', '')}")
    logger.info(f"   专业名称: {course_info.get('专业名称', '')}")
    logger.info(f"   课程名称: {course_info.get('课程名称', '')}")
    logger.info(f"   授课教师: {course_info.get('授课教师', '')}")


def generate_lesson_plan_doc(
    template_path: str,
    output_path: str,
    course_info: dict,
    use_mock: bool = True
) -> bool:
    print_header()
    print_course_info(course_info)
    
    if use_mock:
        logger.info("⚙️  生成模式: 本地模拟数据")
        lesson_data = get_mock_lesson_data(course_info)
    else:
        logger.info("⚙️  生成模式: DeepSeek AI实时生成（单次请求）")
        lesson_data = generate_lesson_plan(course_info)
        if lesson_data and isinstance(lesson_data, dict) and lesson_data.get("error") == "invalid_api_key":
            logger.error("❌ API Key无效，停止生成")
            return "invalid_api_key"
        if lesson_data is None:
            logger.error("❌ 大模型调用失败，使用默认数据")
            lesson_data = get_mock_lesson_data(course_info)
    
    logger.info(f"📄 正在打开模板: {template_path}")
    try:
        doc = LessonPlanDoc(template_path)
        logger.info("   ✅ 模板打开成功")
    except Exception as e:
        logger.error(f"   ❌ 打开模板失败：{e}")
        return False
    
    logger.info("📊 步骤1: 填充基础信息表格")
    doc.fill_basic_info(course_info)
    logger.info("   ✅ 基础信息填充完成")
    
    logger.info("📊 步骤2: 填充教案内容表格")
    doc.fill_content_info(course_info)
    
    modules = [
        (3, format_analysis_text(lesson_data.get("教学内容及学情分析", {})), "教学内容及学情分析"),
        (4, format_objectives_text(lesson_data.get("教学目标", {})), "教学目标"),
        (5, format_list_text(lesson_data.get("教学重点", [])), "教学重点"),
        (6, format_list_text(lesson_data.get("教学难点", [])), "教学难点"),
        (7, format_methods_text(lesson_data.get("教学方法与教学资源", {})), "教学方法与教学资源"),
        (8, format_list_text(lesson_data.get("思政元素", [])), "思政元素"),
    ]
    
    for row, text, name in modules:
        doc.fill_content_module(row, text)
        logger.info(f"   ✅ {name}")
    
    logger.info("📊 步骤3: 填充教学实施过程")
    process_steps = lesson_data.get("教学实施过程", [])
    logger.info(f"   📋 共 {len(process_steps)} 个教学环节")
    for i, step in enumerate(process_steps, 1):
        logger.info(f"      环节{i}: {step.get('环节', 'N/A')} ({step.get('时间', 'N/A')})")
    
    homework_text = format_homework_text(lesson_data.get("课外作业", {}))
    doc.fill_process_table(process_steps, homework_text)
    logger.info("   ✅ 教学环节填充完成")
    logger.info("   ✅ 课外作业填充完成")
    
    logger.info("💾 正在保存教案...")
    try:
        doc.save(output_path)
        logger.info("   ✅ 教案保存成功！")
        logger.info("=" * 60)
        logger.info("🎉 教案生成完成!")
        logger.info("=" * 60)
        logger.info(f"📄 输出文件: {output_path}")
        logger.info(f"📋 课程名称: {course_info['课题名称']}")
        logger.info(f"👨‍🏫 授课教师: {course_info.get('授课教师', '')}")
        logger.info(f"⚡ 优化效果: 从8次API请求减少到1次")
        logger.info("=" * 60)
        return True
    except Exception as e:
        logger.error(f"   ❌ 保存文件失败：{e}")
        return False


def main():
    """主函数"""
    # 获取当前脚本所在目录
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 设置文件路径
    template_path = os.path.join(base_dir, "moban.docx")
    output_path = os.path.join(base_dir, "自动生成的教案.docx")
    
    # 使用默认课程信息（可以修改为从配置文件或命令行参数读取）
    course_info = DEFAULT_COURSE_INFO
    
    # 生成教案
    # use_mock=False 表示调用DeepSeek API，True表示使用模拟数据
    success = generate_lesson_plan_doc(
        template_path=template_path,
        output_path=output_path,
        course_info=course_info,
        use_mock=True  # 改为True可使用模拟数据测试
    )
    
    return 0 if success else 1


def batch_generate_lesson_plans(
    template_path: str,
    output_dir: str,
    fixed_course_info: dict,
    variable_course_infos: list,
    use_mock: bool = True
) -> bool:
    print_header()
    logger.info("📋 批量生成教案")
    logger.info(f"   固定信息: {fixed_course_info}")
    logger.info(f"   共 {len(variable_course_infos)} 个课时")
    
    os.makedirs(output_dir, exist_ok=True)
    
    all_success = True
    
    for i, variable_info in enumerate(variable_course_infos, 1):
        course_info = {
            **fixed_course_info,
            **variable_info
        }
        
        topic = course_info.get("课题名称", f"课时{i}")
        safe_topic = topic.replace("\\", "-").replace("/", "-").replace(":", "-").replace("*", "-").replace("?", "-").replace('"', "-").replace('<', "-").replace('>', "-").replace('|', "-")
        output_path = os.path.join(output_dir, f"{i:02d}_{safe_topic}.docx")
        
        logger.info(f"课时 {i}: {topic}")
        logger.info(f"   输出文件: {output_path}")
        
        success = generate_lesson_plan_doc(
            template_path=template_path,
            output_path=output_path,
            course_info=course_info,
            use_mock=use_mock
        )
        
        if not success:
            all_success = False
            logger.error(f"   ❌ 生成失败")
        else:
            logger.info(f"   ✅ 生成成功")
    
    logger.info("=" * 60)
    logger.info(f"批量生成完成! 成功: {all_success}")
    logger.info(f"生成文件数: {len(variable_course_infos)}")
    logger.info(f"输出目录: {output_dir}")
    logger.info("=" * 60)
    
    return all_success


if __name__ == "__main__":
    sys.exit(main())
