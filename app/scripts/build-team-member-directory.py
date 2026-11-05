#!/usr/bin/env python3
"""从 BD Namelist 生成仅用于团队成员搜索的目录，不修改审批名册。"""
import hashlib
import json
from pathlib import Path
import re
import uuid
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'data/BD Namelist.XLSX'
TARGET = ROOT / 'hackhub-api/src/main/resources/team-member-directory.json'
NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def extract(path):
    with zipfile.ZipFile(path) as archive:
        strings = [''.join(t.text or '' for t in node.findall('.//m:t', NS))
                   for node in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('m:si', NS)]
        rows = []
        for row in ET.fromstring(archive.read('xl/worksheets/sheet1.xml')).findall('.//m:sheetData/m:row', NS):
            cells = {}
            for cell in row:
                node = cell.find('m:v', NS)
                text = node.text or '' if node is not None else ''
                if cell.get('t') == 's':
                    text = strings[int(text)]
                elif cell.get('t') == 'inlineStr':
                    text = ''.join(t.text or '' for t in cell.findall('.//m:t', NS))
                cells[re.sub(r'\d', '', cell.attrib['r'])] = text.strip()
            rows.append(cells)
    expected = {'A': 'Pers.No.', 'B': 'Organizational Unit', 'C': 'Personnel Number'}
    if not rows or any(rows[0].get(key) != value for key, value in expected.items()):
        raise ValueError('名册表头不匹配，请先检查源文件')
    entries = {}
    for row in rows[1:]:
        if not any(row.values()):
            continue
        number, full_name, org = row.get('A', ''), row.get('C', ''), row.get('B', '')
        if not number or not full_name or not org:
            raise ValueError('名册存在缺少员工编号、姓名或部门的记录')
        # 英文姓名来自原始姓名列的斜杠后部分；不从经理姓名列扩充成员。
        name = full_name.rsplit('/', 1)[-1].strip()
        name = re.sub(r'^(?:Mr|Ms|Mrs|Dr)\.\s*', '', name, flags=re.IGNORECASE)
        entry = {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'hackhub:bd-namelist:' + number)),
                 'name': name, 'fullName': full_name, 'orgUnit': org}
        if number in entries and entries[number] != entry:
            raise ValueError('同一员工编号对应不同资料，请核对名册')
        entries[number] = entry
    return sorted(entries.values(), key=lambda entry: (entry['name'].casefold(), entry['id']))


if __name__ == '__main__':
    entries = extract(SOURCE)
    TARGET.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'members': len(entries), 'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest()}, indent=2))
