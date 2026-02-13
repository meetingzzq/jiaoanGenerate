"""
AI生成模块 - 处理大模型API调用和内容生成
"""
import json
import os
import sys
import time
import requests
from config import DEEPSEEK_API_URL, MODEL_CONFIG
from utils import parse_lesson_plan_json


def get_api_key() -> str:
    """获取API Key，优先从环境变量读取"""
    return os.environ.get('DEEPSEEK_API_KEY', '')


def generate_lesson_plan(course_info: dict) -> dict:
    """
    调用DeepSeek API一次性生成教案所有模块内容
    当数据解析失败时，会自动重试直到成功，并告知大模型具体的错误原因
    
    Args:
        course_info: 课程信息字典
        
    Returns:
        解析后的教案数据字典，如果API Key无效返回 {"error": "invalid_api_key"}
    """
    print("\n  📝 正在调用DeepSeek API生成完整教案内容...")
    
    api_key = get_api_key()
    if not api_key:
        print("     ❌ 未设置API Key")
        return {"error": "invalid_api_key", "message": "未设置DeepSeek API Key"}
    
    # 打印API Key前10位用于调试（隐藏完整Key）
    print(f"     🔑 使用API Key: {api_key[:10]}...{api_key[-4:] if len(api_key) > 14 else ''} (长度: {len(api_key)})")
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    retry_count = 0
    max_retries = 5
    last_error = None
    last_content = None

    # 构建prompt
    prompt = _build_prompt(course_info)

    # 保存prompt到文件
    _save_prompt_to_file(course_info, prompt)

    while retry_count < max_retries:
        try:
            # 如果有之前的错误，添加错误信息到prompt
            current_prompt = prompt
            if last_error and last_content:
                error_prompt = f"\n\n--- 之前的生成结果解析失败 ---\n错误原因：{last_error}\n返回内容：{last_content[:500]}...\n\n请重新生成，确保返回的是纯JSON格式，不要包含任何其他文字说明。"
                current_prompt = prompt + error_prompt
            
            data = {
                **MODEL_CONFIG,
                "messages": [{"role": "user", "content": current_prompt}]
            }
            
            print(f"     ⏳ 发送请求到DeepSeek API... (尝试 {retry_count + 1}/{max_retries})")
            if last_error:
                print(f"     ⚠️  上次错误：{last_error}")
            
            response = requests.post(DEEPSEEK_API_URL, headers=headers, json=data, timeout=60)
            
            # 检查API Key是否无效
            if response.status_code == 401:
                print("     ❌ API Key无效或已过期")
                return {"error": "invalid_api_key", "message": "API Key无效或已过期，请检查您的DeepSeek API Key"}
            
            response.raise_for_status()
            result = response.json()
            content = result["choices"][0]["message"]["content"].strip()
            
            print("     ✅ API调用成功，正在解析数据...")
            print("     📄 模型返回内容:")
            print("     " + "-" * 60)
            # 显示模型返回的内容（最多显示1000个字符）
            if len(content) > 1000:
                print("     " + content[:1000] + "...")
            else:
                print("     " + content)
            print("     " + "-" * 60)
            
            parsed_data = parse_lesson_plan_json(content)
            print("     ✅ 数据解析完成")
            return parsed_data
            
        except requests.exceptions.HTTPError as e:
            if response.status_code == 401:
                print("     ❌ API Key无效或已过期")
                return {"error": "invalid_api_key", "message": "API Key无效或已过期，请检查您的DeepSeek API Key"}
            print(f"     ❌ HTTP请求失败：{e}")
            retry_count += 1
            if retry_count < max_retries:
                print(f"     🔄 准备重试...")
            continue
        except requests.exceptions.RequestException as e:
            print(f"     ❌ API请求失败：{e}")
            retry_count += 1
            if retry_count < max_retries:
                print(f"     🔄 准备重试...")
            continue
        except json.JSONDecodeError as e:
            print(f"     ❌ JSON解析失败：{e}")
            last_error = str(e)
            last_content = content
            retry_count += 1
            if retry_count < max_retries:
                print(f"     🔄 准备重试，告知大模型JSON格式错误...")
            continue
        except Exception as e:
            print(f"     ❌ 处理失败：{e}")
            last_error = str(e)
            if 'content' in locals():
                last_content = content
            retry_count += 1
            if retry_count < max_retries:
                print(f"     🔄 准备重试...")
            continue
    
    print(f"     ❌ 达到最大重试次数 ({max_retries})，返回None")
    return None


def _build_prompt(course_info: dict) -> str:
    """构建请求大模型的Prompt"""
    # 获取用户描述（如果有）
    user_description = course_info.get('用户描述', '').strip()
    
    # 获取参考文档内容（如果有）
    reference_documents = course_info.get('参考文档', [])
    
    # 构建用户描述部分
    user_desc_section = ""
    if user_description:
        user_desc_section = f"""

【教师对本节课的描述和想法】
{user_description}

请特别注意：以上描述是授课教师对本节课的具体设想和期望，在生成教案内容时，请务必结合并体现这些想法，使生成的教案更贴近教师的实际教学需求。"""

    # 构建参考文档部分
    doc_section = ""
    if reference_documents and len(reference_documents) > 0:
        doc_contents = []
        for i, doc in enumerate(reference_documents, 1):
            doc_content = doc.get('content', '').strip()
            if doc_content:
                # 限制每个文档的内容长度，避免超出token限制
                max_doc_length = 30000
                if len(doc_content) > max_doc_length:
                    doc_content = doc_content[:max_doc_length] + "...\n[文档内容过长，已截断]"
                doc_contents.append(f"""
--- 参考文档{i}: {doc.get('filename', '未命名文档')} ---
{doc_content}
""")

        if doc_contents:
            doc_section = f"""

【参考文档内容】
{''.join(doc_contents)}

请特别注意：以上文档是本节课的参考资料，包含重要的教学内容、知识点或教学素材。在生成教案时，请务必：
1. 仔细阅读并理解文档中的核心内容
2. 将文档中的知识点融入到教学目标、教学内容和教学实施过程中
3. 参考文档中的案例、示例或数据来丰富教案内容
4. 确保生成的教案与参考文档的内容保持一致性和连贯性"""

    return f"""请为以下课程生成完整的教案内容，以JSON格式返回。

课程信息：
- 课题名称：{course_info['课题名称']}
- 专业名称：{course_info.get('专业名称', '')}
- 课程名称：{course_info.get('课程名称', '')}
- 授课班级：{course_info['授课班级']}
- 授课学时：{course_info.get('授课学时', '')}{user_desc_section}{doc_section}

请严格按照以下JSON格式返回（不要添加任何其他文字说明，只返回JSON）
避免error：Expecting ',' delimiter: line 29 column 5 (char 1311)：

{{
    "教学内容及学情分析": {{
        "教学内容": "详细描述本节课的教学内容，200-300字",
        "学情分析": "分析学生已有基础、学习特点和可能遇到的困难，150-200字"
    }},
    "教学目标": {{
        "知识目标": "掌握...，理解...",
        "能力目标": "能独立完成...，具备...能力",
        "素质目标": "培养...意识，树立...精神"
    }},
    "教学重点": [
        "重点1：核心知识点或技能",
        "重点2：关键操作步骤",
        "重点3：安全规范或质量标准"
    ],
    "教学难点": [
        "难点1：抽象概念或复杂操作",
        "难点2：易错环节或常见困惑"
    ],
    "教学方法与教学资源": {{
        "教学方法": "项目教学法、任务驱动法、示范教学法",
        "教学资源": "实训设备、多媒体课件、操作手册"
    }},
    "思政元素": [
        "思政点1：结合专业领域的国家发展价值",
        "思政点2：强调职业规范、工匠精神",
        "思政点3：培养团队协作和安全意识",
        "思政点4：增强民族自豪感和自主创新意识"
    ],
    "教学实施过程": [
        {{
            "环节": "环节名称（如：任务导入、知识讲解等）",
            "时间": "XXmin",
            "内容": "具体教学内容描述",
            "教师活动": "教师的具体活动",
            "学生活动": "学生的具体活动"
        }}
    ],
    "课外作业": {{
        "基础题": "巩固基础知识的题目",
        "提升题": "拓展能力的题目",
        "预习题": "下节课预习内容"
    }}
}}

要求：
1. 严格按照上述JSON格式返回，确保JSON格式合法
2. 教学实施过程的环节数量由你根据课题特点灵活设计（建议4-6个环节），总时长必须严格控制在1学时45分钟。根据授课学时，计算总时长，每个环节的时间分配要合理。
3. 各环节时间分配要合理，符合理实一体化教学规律（如：导入5-10分钟、总结5-10分钟）
4. 内容要贴合课题特点，符合高职理实一体化教学特点
5. 所有文本字段使用纯文本，不要使用Markdown格式
6. 避免error：Expecting ',' delimiter: line 29 column 5 (char 1311)
7. 只返回JSON，不要添加```json标记或其他说明文字"""


def get_mock_lesson_data(course_info: dict) -> dict:
    """返回模拟的教案数据（用于测试）"""
    return {
        "教学内容及学情分析": {
        "教学内容": "本节课先通过知识回顾环节复习无人机机体材料及应用，检查相关作业并以提问方式引出电气材料主题；随后重点讲解无人机装调的电气材料，包括插头类、线材类、辅助类的种类及核心用途，再讲解加固材料的种类及装调场景应用，明确各类材料对应的使用场景和注意事项。",
        "学情分析": "学生对插头、电线、胶水等材料有生活认知，能快速关联连接、固定的功能，具备一定的材料特性基础认知；但对插头型号适配性、AWG硅胶线型号与粗细的关系理解模糊，缺乏专业的材料选型和应用认知。"
    },
    "教学目标": {
        "知识目标": "能说出3类电气材料、2类加固材料的名称；能对应2类材料的用途，明确XT60插头、尼龙扎带等核心材料的应用场景；知道“AWG型号越大，硅胶线越细”的规则。",
        "能力目标": "能根据无人机装调的具体场景，准确选择对应的电气材料和加固材料，建立“场景-材料”的匹配逻辑。",
        "素质目标": "通过插头型号错配导致短路的案例，培养规范操作的职业意识；通过国产加固材料的高性价比案例，渗透国货优选理念，树立支持国产的意识。"
    },
    "教学重点": [
        "电气材料（插头类、线材类）、加固材料的名称及核心用途",
        "XT60插头的适配场景和应用方法",
        "尼龙扎带在无人机装调中的固定应用场景"
    ],
    "教学难点": [
        "区分T型插头与XT60插头的适配场景，明确二者不可混用的原则",
        "理解并掌握AWG硅胶线型号与粗细、承载电流的对应关系"
    ],
    "教学方法与教学资源": {
        "教学方法": "讲授法、图片对比法、案例警示法",
        "教学资源": "课件PPT（含T型/XT60插头、杜邦线、尼龙扎带等材料实物图）、插头错配导致短路的示意图、简化版《电气/加固材料用途表》"
    },
    "思政元素": [
        "通过我国尼龙扎带产量占全球80%、质量达标且价格仅为进口1/3的行业数据，结合无人机装调企业优先选用国产加固材料的实际案例，引导学生认识国货优势，树立支持国产、国货优选的意识",
        "通过插头错配导致短路的安全案例，强调无人机装调的规范操作要求，培养学生严谨细致、遵规守纪的职业素养",
        "在材料选型和应用讲解中，渗透工业制造的标准化理念，培养学生的工程规范意识"
    ],
    "教学实施过程": [
        {
            "环节": "知识回顾",
            "时间": "7min",
            "内容": "提问多旋翼无人机机架的材料及选用原因；检查作业，邀请2名学生分享家中物品材料及特性并点评关联无人机材料应用；展示无人机电池与电调连接图片，追问连接插头类型，导入电气材料主题。",
            "教师活动": "对学生回答进行补充修正；结合作业分享引导学生迁移材料特性的分析逻辑；用实物图片激发学生对电气材料的探究兴趣。",
            "学生活动": "回忆上节课内容并准确回答问题；分享作业内容，倾听同伴分析并迁移学习逻辑；观察图片，思考连接插头的类型。"
        },
        {
            "环节": "新知讲授1：电气材料",
            "时间": "15min",
            "内容": "按连接功能分类讲解电气材料：插头类介绍T型、XT60插头的外观、适配场景及不可混用原则；线材类介绍杜邦线、AWG硅胶线的应用场景及AWG型号与粗细的关系；辅助类介绍焊锡、热缩管的核心用途。",
            "教师活动": "讲解每类材料同步展示实物图，标注核心用途+注意事项；用铅笔型号类比帮助学生理解AWG硅胶线型号与粗细的关系；展示插头错配导致短路的示意图，警示规范选择材料的重要性。",
            "学生活动": "记录材料的名称、用途及注意事项，用不同颜色标注重点；结合类比理解AWG型号规则，观察示意图认识错配的安全风险；主动提问，理解杜邦线适合飞控连接的原因。"
        },
        {
            "环节": "新知讲授2：加固材料",
            "时间": "8min",
            "内容": "按固定功能讲解加固材料：介绍热熔胶、尼龙扎带、魔术贴、螺栓螺母的实物应用场景图，明确各类材料的核心固定用途和使用特点。",
            "教师活动": "展示各类加固材料的应用场景图，引导学生观察固定效果；提出启发性问题，引导学生思考不同材料的选用差异。",
            "学生活动": "记录各类加固材料的用途，标注关键使用特点；思考教师提出的问题，回答材料选用的原因，理解场景与材料的匹配逻辑。"
        },
        {
            "环节": "互动巩固",
            "时间": "8min",
            "内容": "开展“场景选材料”问答活动，给出电池与电调连接、导线捆扎、电池固定3个装调场景，让学生选择对应材料并说明理由。",
            "教师活动": "依次呈现场景，引导学生集体回答；对重点场景进行追问拓展，引导学生思考同一场景的多种材料选择方案。",
            "学生活动": "集体洪亮回答问题并说明材料选用理由；思考拓展问题，举手补充同场景的其他适配材料；强化场景与材料的匹配逻辑。"
        },
        {
            "环节": "小结与课外作业",
            "时间": "2min",
            "内容": "梳理本节课核心知识，回顾电气材料、加固材料的核心用途及2个关键规则；布置课外作业，明确作业要求和下节课分享要求。",
            "教师活动": "以“材料类型+用途”的框架带领学生回顾核心知识，强化记忆；明确课外作业的具体要求，提醒标注用途需结合本节课知识。",
            "学生活动": "跟着教师回顾知识，补充完善课堂笔记；准确记录作业内容，规划课后完成步骤。"
        }
    ],
    "课外作业": {
        "基础题": "网上搜索“无人机XT60插头”“无人机尼龙扎带”的产品图，各保存1张并结合本节课知识标注材料的核心用途，下节课进行分享。",
        "提升题": "对比搜索T型插头和XT60插头的产品参数，简要总结二者在电流承载能力上的差异。",
        "预习题": "预习无人机装调常用工具的种类，了解剥线钳、焊枪的基本使用方法。"
    }
}


def _save_prompt_to_file(course_info: dict, prompt: str):
    """
    将提示词保存到与exe同路径的txt文件

    Args:
        course_info: 课程信息字典
        prompt: 要保存的提示词
    """
    try:
        # 获取exe所在目录（支持PyInstaller打包环境）
        if hasattr(sys, '_MEIPASS'):
            # PyInstaller打包后的环境
            base_dir = os.path.dirname(sys.executable)
        else:
            # 开发环境
            base_dir = os.path.dirname(os.path.abspath(__file__))

        # 生成文件名：使用课题名称和时间戳
        topic = course_info.get('课题名称', '未命名课题')
        safe_topic = topic.replace('\\', '-').replace('/', '-').replace(':', '-').replace('*', '-').replace('?', '-').replace('"', '-').replace('<', '-').replace('>', '-').replace('|', '-')
        timestamp = time.strftime('%Y%m%d_%H%M%S')
        filename = f"提示词_{safe_topic}_{timestamp}.txt"
        filepath = os.path.join(base_dir, filename)

        # 保存提示词到文件
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write("=" * 80 + "\n")
            f.write("教案生成提示词\n")
            f.write("=" * 80 + "\n\n")
            f.write(f"课题名称: {topic}\n")
            f.write(f"课程名称: {course_info.get('课程名称', '')}\n")
            f.write(f"专业名称: {course_info.get('专业名称', '')}\n")
            f.write(f"授课班级: {course_info.get('授课班级', '')}\n")
            f.write(f"授课学时: {course_info.get('授课学时', '')}\n")
            f.write(f"保存时间: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            f.write("\n" + "=" * 80 + "\n")
            f.write("提示词内容:\n")
            f.write("=" * 80 + "\n\n")
            f.write(prompt)

        print(f"     💾 提示词已保存到: {filename}")
    except Exception as e:
        print(f"     ⚠️  保存提示词失败: {e}")
