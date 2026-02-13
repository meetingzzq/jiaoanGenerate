"""
批量生成教案示例
为电子焊接课程生成两个教案
"""
import os
from config import DEFAULT_FIXED_COURSE_INFO
from main import batch_generate_lesson_plans


def generate_electronic_welding_lesson_plans():
    """
    生成电子焊接课程的教案
    """
    # 获取当前目录
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    # 设置文件路径
    template_path = os.path.join(base_dir, "moban.docx")
    output_dir = os.path.join(base_dir, "output")
    
    # 固定课程信息（电子焊接课程）
    fixed_info = {
        **DEFAULT_FIXED_COURSE_INFO,
        "院系": "智能装备学院",
        "授课班级": "电气自动化（2）班",
        "专业名称": "电气自动化",
        "课程名称": "电子焊接",
        "授课教师": "张老师"
    }
    
    # 可变课程信息列表（两个课时）
    variable_infos = [
        {
            "课题名称": "电子元器件认识",
            "授课地点": "电子实训室",
            "授课时间": "2026年2月15日",
            "授课学时": "1学时",
            "授课类型": "理论课"
        },
        {
            "课题名称": "焊接5步法",
            "授课地点": "焊接实训室",
            "授课时间": "2026年2月16日",
            "授课学时": "2学时",
            "授课类型": "理实一体化"
        }
    ]
    
    # 批量生成教案
    success = batch_generate_lesson_plans(
        template_path=template_path,
        output_dir=output_dir,
        fixed_course_info=fixed_info,
        variable_course_infos=variable_infos,
        use_mock=False  # 使用模拟数据，如需调用API可改为False
    )
    
    return success


if __name__ == "__main__":
    print("开始生成电子焊接课程教案...")
    success = generate_electronic_welding_lesson_plans()
    if success:
        print("\n🎉 所有教案生成成功！")
    else:
        print("\n❌ 部分教案生成失败！")
