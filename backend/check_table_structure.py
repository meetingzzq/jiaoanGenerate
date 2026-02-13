from docx import Document

doc = Document("moban.docx")

print("检查第2个表格（教案内容表格）的结构：\n")
table = doc.tables[1]

for row_idx, row in enumerate(table.rows):
    print(f"行{row_idx}:")
    for col_idx, cell in enumerate(row.cells):
        text = cell.text.strip()
        print(f"  列{col_idx}: {text}")
    print()
