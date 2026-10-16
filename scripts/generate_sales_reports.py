# -*- coding: utf-8 -*-
import json
import os
import re
import urllib.request
from datetime import datetime, timezone, timedelta
from collections import defaultdict

import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.units import cm, mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfgen import canvas

SUPABASE_URL = os.environ.get('SUPABASE_URL', 'https://ivjvpdzsfjdpyabbzzuj.supabase.co')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_ROLE_KEY', '')
UNIT_ID = '5fc99a57-81ee-4232-a105-1fcb4634cef4'

tz_belem = timezone(timedelta(hours=-3))

def fetch_supabase(endpoint):
    url = f"{SUPABASE_URL}/rest/v1/{endpoint}"
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json'
    })
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read().decode('utf-8'))

def sanitize_description_lgpd(desc):
    if not desc:
        return "Sessão Playground"
    clean = desc.strip()
    # If contains '—' or ' - ' separating a personal name from duration
    if '—' in clean:
        parts = clean.split('—')
        duration = parts[-1].strip()
        if 'minuto' in duration.lower() or 'hora' in duration.lower() or 'min' in duration.lower():
            return f"Sessão Playground ({duration})"
        return duration
    if ' - ' in clean:
        parts = clean.split(' - ')
        duration = parts[-1].strip()
        if 'minuto' in duration.lower() or 'hora' in duration.lower() or 'min' in duration.lower():
            return f"Sessão Playground ({duration})"
        return duration
    if 'excedente' in clean.lower():
        return f"Tempo {clean}"
    return clean

def load_data():
    print("Obtendo dados do Supabase...")
    unit = fetch_supabase(f"fa_kiosk_units?id=eq.{UNIT_ID}")[0]
    orders = fetch_supabase(f"fa_kiosk_orders?unit_id=eq.{UNIT_ID}&business_date=gte.2026-10-08&order=created_at.asc")
    order_ids = [o['id'] for o in orders]

    # Fetch payments
    payments = []
    for i in range(0, len(order_ids), 50):
        chunk = order_ids[i:i+50]
        p = fetch_supabase(f"fa_kiosk_payments?order_id=in.({','.join(chunk)})")
        payments.extend(p)

    # Fetch items
    items = []
    for i in range(0, len(order_ids), 50):
        chunk = order_ids[i:i+50]
        it = fetch_supabase(f"fa_kiosk_order_items?order_id=in.({','.join(chunk)})")
        items.extend(it)

    employees = fetch_supabase("fa_kiosk_employees?select=id,full_name,role")

    return {
        'unit': unit,
        'orders': orders,
        'payments': payments,
        'items': items,
        'employees': employees
    }

def build_dataset(data):
    unit = data['unit']
    orders = data['orders']
    payments = data['payments']
    items = data['items']
    employees = {e['id']: e for e in data.get('employees', [])}

    pay_by_order = defaultdict(list)
    for p in payments:
        pay_by_order[p['order_id']].append(p)

    items_by_order = defaultdict(list)
    for it in items:
        items_by_order[it['order_id']].append(it)

    processed_orders = []
    day_names = {
        0: 'Segunda-feira',
        1: 'Terça-feira',
        2: 'Quarta-feira',
        3: 'Quinta-feira',
        4: 'Sexta-feira',
        5: 'Sábado',
        6: 'Domingo'
    }

    daily_summary = defaultdict(lambda: {
        'count': 0,
        'total_cents': 0,
        'credito_cents': 0,
        'debito_cents': 0,
        'pix_cents': 0,
        'dinheiro_cents': 0,
        'voucher_cents': 0
    })

    method_totals = defaultdict(int)

    # Ensure all days from 2026-10-08 to 2026-10-16
    start_dt = datetime(2026, 10, 8)
    end_dt = datetime(2026, 10, 16)
    curr_dt = start_dt
    while curr_dt <= end_dt:
        d_str = curr_dt.strftime('%Y-%m-%d')
        _ = daily_summary[d_str]
        curr_dt += timedelta(days=1)

    for o in orders:
        b_date = o['business_date']
        tot = o['total_cents']
        daily_summary[b_date]['count'] += 1
        daily_summary[b_date]['total_cents'] += tot

        order_pays = pay_by_order[o['id']]
        methods_list = []
        for p in order_pays:
            m = p['method'].upper()
            amt = p['amount_cents']
            method_totals[m] += amt
            if m == 'CREDITO':
                daily_summary[b_date]['credito_cents'] += amt
            elif m == 'DEBITO':
                daily_summary[b_date]['debito_cents'] += amt
            elif m == 'PIX':
                daily_summary[b_date]['pix_cents'] += amt
            elif m == 'DINHEIRO':
                daily_summary[b_date]['dinheiro_cents'] += amt
            else:
                daily_summary[b_date]['voucher_cents'] += amt
            methods_list.append(f"{m} (R$ {amt/100:.2f})")

        dt_utc = datetime.fromisoformat(o['created_at'].replace('Z', '+00:00'))
        dt_local = dt_utc.astimezone(tz_belem)

        # Operator (PDV identification, no personal customer data)
        emp_id = o.get('closed_by_employee_id')
        operator_name = employees.get(emp_id, {}).get('full_name', 'Operador PDV')

        # Items descriptions sanitized according to LGPD
        o_items = items_by_order[o['id']]
        sanitized_items = []
        for it in o_items:
            sanitized_items.append(sanitize_description_lgpd(it.get('description')))

        processed_orders.append({
            'order_id': o['id'],
            'order_code': o.get('order_code') or o['id'][:8].upper(),
            'business_date': b_date,
            'local_datetime': dt_local,
            'local_datetime_str': dt_local.strftime('%d/%m/%Y %H:%M:%S'),
            'date_str': dt_local.strftime('%d/%m/%Y'),
            'time_str': dt_local.strftime('%H:%M:%S'),
            'operator': operator_name,
            'items_desc': '; '.join(sanitized_items) or 'Sessão Playground',
            'items_count': len(o_items),
            'payment_methods_str': ', '.join(methods_list) or 'PAGO',
            'payment_method_primary': order_pays[0]['method'] if order_pays else '—',
            'total_cents': tot,
            'total_reais': tot / 100.0,
            'status': o.get('status', 'PAGA')
        })

    processed_orders.sort(key=lambda x: x['local_datetime'])

    return {
        'unit': unit,
        'orders': processed_orders,
        'daily_summary': daily_summary,
        'method_totals': method_totals,
        'day_names': day_names,
        'total_orders': len(processed_orders),
        'total_cents': sum(o['total_cents'] for o in processed_orders),
        'total_reais': sum(o['total_cents'] for o in processed_orders) / 100.0,
        'raw_items': items
    }

def generate_excel(dataset, output_path):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)

    font_title = Font(name='Calibri', size=16, bold=True, color='FFFFFF')
    font_subtitle = Font(name='Calibri', size=10, bold=True, color='E2E8F0')
    font_sec_header = Font(name='Calibri', size=12, bold=True, color='1E293B')
    font_table_hdr = Font(name='Calibri', size=10, bold=True, color='FFFFFF')
    font_bold = Font(name='Calibri', size=10, bold=True, color='1E293B')
    font_regular = Font(name='Calibri', size=10, color='334155')
    font_kpi_num = Font(name='Calibri', size=16, bold=True, color='0F172A')
    font_kpi_lbl = Font(name='Calibri', size=9, bold=True, color='64748B')
    font_lgpd_badge = Font(name='Calibri', size=9, bold=True, color='065F46')

    fill_navy = PatternFill(start_color='1E3A8A', end_color='1E3A8A', fill_type='solid')
    fill_blue_hdr = PatternFill(start_color='2563EB', end_color='2563EB', fill_type='solid')
    fill_sub_hdr = PatternFill(start_color='0284C7', end_color='0284C7', fill_type='solid')
    fill_zebra = PatternFill(start_color='F8FAFC', end_color='F8FAFC', fill_type='solid')
    fill_total = PatternFill(start_color='E2E8F0', end_color='E2E8F0', fill_type='solid')
    fill_kpi = PatternFill(start_color='F1F5F9', end_color='F1F5F9', fill_type='solid')
    fill_lgpd = PatternFill(start_color='ECFDF5', end_color='ECFDF5', fill_type='solid')

    border_thin = Border(
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1'),
        top=Side(style='thin', color='CBD5E1'),
        bottom=Side(style='thin', color='CBD5E1')
    )
    border_total = Border(
        top=Side(style='thin', color='0F172A'),
        bottom=Side(style='double', color='0F172A'),
        left=Side(style='thin', color='CBD5E1'),
        right=Side(style='thin', color='CBD5E1')
    )

    align_center = Alignment(horizontal='center', vertical='center')
    align_left = Alignment(horizontal='left', vertical='center')
    align_right = Alignment(horizontal='right', vertical='center')

    # ==============================================================
    # TAB 1: RESUMO CONSOLIDADO SHOPPING
    # ==============================================================
    ws1 = wb.create_sheet(title='Resumo Consolidado Shopping')
    ws1.views.sheetView[0].showGridLines = True

    ws1.merge_cells('A1:J2')
    title_cell = ws1['A1']
    title_cell.value = "RELATÓRIO OFICIAL DE VENDAS E APURAÇÃO DE FATURAMENTO"
    title_cell.font = font_title
    title_cell.fill = fill_navy
    title_cell.alignment = align_center

    ws1.merge_cells('A3:J3')
    sub_cell = ws1['A3']
    sub_cell.value = "Demonstrativo para Auditoria e Prestação de Contas — Shopping Bosque Grão-Pará"
    sub_cell.font = font_subtitle
    sub_cell.fill = fill_blue_hdr
    sub_cell.alignment = align_center

    # LGPD Compliance Banner
    ws1.merge_cells('A4:J4')
    lgpd_cell = ws1['A4']
    lgpd_cell.value = "🔒 RELATÓRIO EM CONFORMIDADE COM A LGPD (LEI Nº 13.709/2018) — DADOS PESSOAIS E DE MENORES SUPRIMIDOS"
    lgpd_cell.font = font_lgpd_badge
    lgpd_cell.fill = fill_lgpd
    lgpd_cell.alignment = align_center

    # Company info block
    unit = dataset['unit']
    ws1['A6'] = "Razão Social:"
    ws1['A6'].font = font_bold
    ws1['B6'] = unit.get('razao_social', 'FACA AMIGOS BRINQUEDOTECA II LTDA')
    ws1['B6'].font = font_regular

    ws1['E6'] = "CNPJ:"
    ws1['E6'].font = font_bold
    ws1['F6'] = "66.604.382/0001-70"
    ws1['F6'].font = font_regular

    ws1['H6'] = "Inscrição Estadual:"
    ws1['H6'].font = font_bold
    ws1['I6'] = unit.get('inscricao_estadual', '75.105.192-6')
    ws1['I6'].font = font_regular

    ws1['A7'] = "Nome Fantasia:"
    ws1['A7'].font = font_bold
    ws1['B7'] = f"{unit.get('nome_fantasia', 'FAÇA AMIGOS')} — {unit.get('name', 'Playground (Bosque Grão-Pará)')}"
    ws1['B7'].font = font_regular

    ws1['E7'] = "Estabelecimento:"
    ws1['E7'].font = font_bold
    ws1['F7'] = "Shopping Bosque Grão-Pará — Belém/PA"
    ws1['F7'].font = font_regular

    ws1['H7'] = "Regime Tributário:"
    ws1['H7'].font = font_bold
    ws1['I7'] = "Simples Nacional (CRT 1 - ME/EPP)"
    ws1['I7'].font = font_regular

    ws1['A8'] = "Endereço:"
    ws1['A8'].font = font_bold
    ws1['B8'] = unit.get('address', 'Av. Centenário, 1052 - Val-de-Cans, Belém/PA - CEP 66635-894')
    ws1['B8'].font = font_regular

    ws1['E8'] = "Período Apurado:"
    ws1['E8'].font = font_bold
    ws1['F8'] = "08/10/2026 a 16/10/2026"
    ws1['F8'].font = font_bold

    ws1['H8'] = "Emissão:"
    ws1['H8'].font = font_bold
    ws1['I8'] = "16/10/2026 12:05:00"
    ws1['I8'].font = font_regular

    # KPI Cards Block (Row 10 to 11)
    kpis = [
        ('FATURAMENTO BRUTO TOTAL', f"R$ {dataset['total_reais']:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), 'A', 'B'),
        ('TOTAL DE TRANSAÇÕES', f"{dataset['total_orders']}", 'D', 'E'),
        ('TICKET MÉDIO / VENDA', f"R$ {dataset['total_reais']/max(1, dataset['total_orders']):,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), 'G', 'H'),
        ('TOTAL DE ATENDIMENTOS', f"{len(dataset['raw_items'])}", 'I', 'J')
    ]
    for lbl, val, c1, c2 in kpis:
        ws1.merge_cells(f'{c1}10:{c2}10')
        ws1.merge_cells(f'{c1}11:{c2}11')
        cell_lbl = ws1[f'{c1}10']
        cell_lbl.value = lbl
        cell_lbl.font = font_kpi_lbl
        cell_lbl.alignment = align_center
        cell_lbl.fill = fill_kpi

        cell_val = ws1[f'{c1}11']
        cell_val.value = val
        cell_val.font = font_kpi_num
        cell_val.alignment = align_center
        cell_val.fill = fill_kpi

        for row in ws1[f'{c1}10:{c2}11']:
            for c in row:
                c.border = border_thin

    # Daily Table Header
    ws1.cell(row=13, column=1, value="DEMONSTRATIVO DIÁRIO CONSOLIDADO DE VENDAS").font = font_sec_header

    daily_cols = [
        ("Data Movimento", align_center, 16),
        ("Dia da Semana", align_left, 18),
        ("Qtd. Transações", align_center, 16),
        ("Cartão de Crédito (R$)", align_right, 22),
        ("Cartão de Débito (R$)", align_right, 22),
        ("PIX (R$)", align_right, 18),
        ("Dinheiro (R$)", align_right, 18),
        ("Faturamento Bruto (R$)", align_right, 24),
        ("Ticket Médio (R$)", align_right, 18),
        ("% Partic.", align_right, 14)
    ]

    hdr_row = 14
    for col_idx, (col_name, col_align, _) in enumerate(daily_cols, start=1):
        cell = ws1.cell(row=hdr_row, column=col_idx, value=col_name)
        cell.font = font_table_hdr
        cell.fill = fill_blue_hdr
        cell.alignment = col_align
        cell.border = border_thin

    curr_row = 15
    sorted_days = sorted(dataset['daily_summary'].keys())
    day_names = dataset['day_names']
    total_gross = dataset['total_reais']

    for d_str in sorted_days:
        d_obj = datetime.strptime(d_str, '%Y-%m-%d')
        weekday_name = day_names[d_obj.weekday()]
        d_info = dataset['daily_summary'][d_str]
        d_val = d_info['total_cents'] / 100.0
        d_count = d_info['count']
        tkt_medio = d_val / d_count if d_count > 0 else 0.0
        pct = (d_val / total_gross) if total_gross > 0 else 0.0

        fill_row = fill_zebra if curr_row % 2 == 0 else PatternFill(fill_type=None)

        vals = [
            (d_obj.strftime('%d/%m/%Y'), align_center, '@'),
            (weekday_name, align_left, '@'),
            (d_count, align_center, '#,##0'),
            (d_info['credito_cents'] / 100.0, align_right, 'R$ #,##0.00'),
            (d_info['debito_cents'] / 100.0, align_right, 'R$ #,##0.00'),
            (d_info['pix_cents'] / 100.0, align_right, 'R$ #,##0.00'),
            (d_info['dinheiro_cents'] / 100.0, align_right, 'R$ #,##0.00'),
            (d_val, align_right, 'R$ #,##0.00'),
            (tkt_medio, align_right, 'R$ #,##0.00'),
            (pct, align_right, '0.00%')
        ]

        for col_idx, (val, al, num_fmt) in enumerate(vals, start=1):
            cell = ws1.cell(row=curr_row, column=col_idx, value=val)
            cell.font = font_regular
            cell.alignment = al
            cell.border = border_thin
            if fill_row.fill_type:
                cell.fill = fill_row
            cell.number_format = num_fmt

        curr_row += 1

    # Total Row with Formulas
    ws1.cell(row=curr_row, column=1, value="TOTAL CONSOLIDADO").font = font_bold
    ws1.cell(row=curr_row, column=1).alignment = align_center
    ws1.cell(row=curr_row, column=1).fill = fill_total
    ws1.cell(row=curr_row, column=1).border = border_total

    ws1.cell(row=curr_row, column=2, value="").fill = fill_total
    ws1.cell(row=curr_row, column=2).border = border_total

    c_count = ws1.cell(row=curr_row, column=3, value=f"=SUM(C15:C{curr_row-1})")
    c_count.font = font_bold
    c_count.alignment = align_center
    c_count.fill = fill_total
    c_count.border = border_total
    c_count.number_format = '#,##0'

    c_cred = ws1.cell(row=curr_row, column=4, value=f"=SUM(D15:D{curr_row-1})")
    c_cred.font = font_bold
    c_cred.alignment = align_right
    c_cred.fill = fill_total
    c_cred.border = border_total
    c_cred.number_format = 'R$ #,##0.00'

    c_deb = ws1.cell(row=curr_row, column=5, value=f"=SUM(E15:E{curr_row-1})")
    c_deb.font = font_bold
    c_deb.alignment = align_right
    c_deb.fill = fill_total
    c_deb.border = border_total
    c_deb.number_format = 'R$ #,##0.00'

    c_pix = ws1.cell(row=curr_row, column=6, value=f"=SUM(F15:F{curr_row-1})")
    c_pix.font = font_bold
    c_pix.alignment = align_right
    c_pix.fill = fill_total
    c_pix.border = border_total
    c_pix.number_format = 'R$ #,##0.00'

    c_din = ws1.cell(row=curr_row, column=7, value=f"=SUM(G15:G{curr_row-1})")
    c_din.font = font_bold
    c_din.alignment = align_right
    c_din.fill = fill_total
    c_din.border = border_total
    c_din.number_format = 'R$ #,##0.00'

    c_tot = ws1.cell(row=curr_row, column=8, value=f"=SUM(H15:H{curr_row-1})")
    c_tot.font = font_bold
    c_tot.alignment = align_right
    c_tot.fill = fill_total
    c_tot.border = border_total
    c_tot.number_format = 'R$ #,##0.00'

    c_avg = ws1.cell(row=curr_row, column=9, value=f"=H{curr_row}/C{curr_row}")
    c_avg.font = font_bold
    c_avg.alignment = align_right
    c_avg.fill = fill_total
    c_avg.border = border_total
    c_avg.number_format = 'R$ #,##0.00'

    c_pct = ws1.cell(row=curr_row, column=10, value="100.00%")
    c_pct.font = font_bold
    c_pct.alignment = align_right
    c_pct.fill = fill_total
    c_pct.border = border_total

    # Table 2: Consolidation by Payment Method
    curr_row += 3
    ws1.cell(row=curr_row, column=1, value="SÍNTESE CONSOLIDADA POR MEIO DE PAGAMENTO").font = font_sec_header
    curr_row += 1

    pay_hdr_row = curr_row
    ws1.cell(row=pay_hdr_row, column=1, value="Meio de Pagamento").font = font_table_hdr
    ws1.cell(row=pay_hdr_row, column=1).fill = fill_sub_hdr
    ws1.cell(row=pay_hdr_row, column=1).alignment = align_left
    ws1.cell(row=pay_hdr_row, column=1).border = border_thin

    ws1.cell(row=pay_hdr_row, column=2, value="Valor Total (R$)").font = font_table_hdr
    ws1.cell(row=pay_hdr_row, column=2).fill = fill_sub_hdr
    ws1.cell(row=pay_hdr_row, column=2).alignment = align_right
    ws1.cell(row=pay_hdr_row, column=2).border = border_thin

    ws1.cell(row=pay_hdr_row, column=3, value="% Participação").font = font_table_hdr
    ws1.cell(row=pay_hdr_row, column=3).fill = fill_sub_hdr
    ws1.cell(row=pay_hdr_row, column=3).alignment = align_right
    ws1.cell(row=pay_hdr_row, column=3).border = border_thin

    curr_row += 1
    pay_methods_order = [('CREDITO', 'Cartão de Crédito'), ('DEBITO', 'Cartão de Débito'), ('PIX', 'PIX'), ('DINHEIRO', 'Dinheiro')]
    for m_code, m_label in pay_methods_order:
        amt = dataset['method_totals'].get(m_code, 0) / 100.0
        pct = (amt / total_gross) if total_gross > 0 else 0.0

        c1 = ws1.cell(row=curr_row, column=1, value=m_label)
        c1.font = font_regular
        c1.border = border_thin

        c2 = ws1.cell(row=curr_row, column=2, value=amt)
        c2.font = font_regular
        c2.alignment = align_right
        c2.border = border_thin
        c2.number_format = 'R$ #,##0.00'

        c3 = ws1.cell(row=curr_row, column=3, value=pct)
        c3.font = font_regular
        c3.alignment = align_right
        c3.border = border_thin
        c3.number_format = '0.00%'

        curr_row += 1

    c1 = ws1.cell(row=curr_row, column=1, value="TOTAL GERAL")
    c1.font = font_bold
    c1.fill = fill_total
    c1.border = border_total

    c2 = ws1.cell(row=curr_row, column=2, value=f"=SUM(B{pay_hdr_row+1}:B{curr_row-1})")
    c2.font = font_bold
    c2.alignment = align_right
    c2.fill = fill_total
    c2.border = border_total
    c2.number_format = 'R$ #,##0.00'

    c3 = ws1.cell(row=curr_row, column=3, value="100.00%")
    c3.font = font_bold
    c3.alignment = align_right
    c3.fill = fill_total
    c3.border = border_total

    curr_row += 3
    ws1.merge_cells(f'A{curr_row}:J{curr_row+2}')
    note_cell = ws1[f'A{curr_row}']
    note_cell.value = (
        "DECLARAÇÃO DE CONFORMIDADE PARA O SHOPPING CENTER & LGPD:\n"
        "Declaramos que as informações deste relatório refletem com fidedignidade a totalidade das operações mercantis "
        "e prestações de serviços realizadas no estabelecimento Faça Amigos Playground Bosque Grão-Pará. "
        "Em observância à Lei Geral de Proteção de Dados (Lei nº 13.709/2018 - LGPD), dados pessoais de clientes "
        "e especialmente de crianças e adolescentes (Art. 14) foram integralmente suprimidos deste documento externo."
    )
    note_cell.font = Font(name='Calibri', size=9, italic=True, color='475569')
    note_cell.alignment = Alignment(horizontal='left', vertical='center', wrap_text=True)
    note_cell.fill = fill_zebra
    for r in range(curr_row, curr_row + 3):
        for c in range(1, 11):
            ws1.cell(row=r, column=c).border = border_thin

    for col_idx, (_, _, col_width) in enumerate(daily_cols, start=1):
        col_letter = get_column_letter(col_idx)
        ws1.column_dimensions[col_letter].width = col_width

    # ==============================================================
    # TAB 2: ANALÍTICO DE TRANSAÇÕES (LGPD COMPLIANT - SEM DADOS PESSOAIS)
    # ==============================================================
    ws2 = wb.create_sheet(title='Vendas Analítico (LGPD)')
    ws2.views.sheetView[0].showGridLines = True

    ws2.merge_cells('A1:H2')
    t2 = ws2['A1']
    t2.value = "DETALHAMENTO ANALÍTICO DE VENDAS E SESSÕES — BOSQUE GRÃO-PARÁ"
    t2.font = font_title
    t2.fill = fill_navy
    t2.alignment = align_center

    ws2.merge_cells('A3:H3')
    t2_sub = ws2['A3']
    t2_sub.value = "Em conformidade com a LGPD (Lei nº 13.709/2018) — Dados pessoais de clientes e menores suprimidos."
    t2_sub.font = font_lgpd_badge
    t2_sub.fill = fill_lgpd
    t2_sub.alignment = align_center

    analitico_cols = [
        ("Nº Pedido / Cupom", align_center, 20),
        ("Data", align_center, 14),
        ("Hora", align_center, 12),
        ("Descrição do Serviço / Produto (Sanitizado)", align_left, 45),
        ("Qtd Itens", align_center, 12),
        ("Operador PDV", align_left, 24),
        ("Forma Pagamento", align_left, 24),
        ("Valor Bruto (R$)", align_right, 20),
        ("Status", align_center, 14)
    ]

    hdr_row2 = 5
    for col_idx, (col_name, col_align, _) in enumerate(analitico_cols, start=1):
        c = ws2.cell(row=hdr_row2, column=col_idx, value=col_name)
        c.font = font_table_hdr
        c.fill = fill_blue_hdr
        c.alignment = col_align
        c.border = border_thin

    curr_row2 = 6
    for idx, o in enumerate(dataset['orders'], start=1):
        fill_row = fill_zebra if idx % 2 == 0 else PatternFill(fill_type=None)

        vals = [
            (o['order_code'], align_center, '@'),
            (o['date_str'], align_center, '@'),
            (o['time_str'], align_center, '@'),
            (o['items_desc'], align_left, '@'),
            (o['items_count'], align_center, '#,##0'),
            (o['operator'], align_left, '@'),
            (o['payment_methods_str'], align_left, '@'),
            (o['total_reais'], align_right, 'R$ #,##0.00'),
            (o['status'], align_center, '@')
        ]

        for col_idx, (val, al, num_fmt) in enumerate(vals, start=1):
            c = ws2.cell(row=curr_row2, column=col_idx, value=val)
            c.font = font_regular
            c.alignment = al
            c.border = border_thin
            if fill_row.fill_type:
                c.fill = fill_row
            c.number_format = num_fmt

        curr_row2 += 1

    # Total row for Tab 2
    ws2.cell(row=curr_row2, column=1, value="TOTAL GERAL").font = font_bold
    ws2.cell(row=curr_row2, column=1).alignment = align_center
    ws2.cell(row=curr_row2, column=1).fill = fill_total
    ws2.cell(row=curr_row2, column=1).border = border_total

    for col in range(2, 5):
        c = ws2.cell(row=curr_row2, column=col, value="")
        c.fill = fill_total
        c.border = border_total

    c_cnt = ws2.cell(row=curr_row2, column=5, value=f"=SUM(E6:E{curr_row2-1})")
    c_cnt.font = font_bold
    c_cnt.alignment = align_center
    c_cnt.fill = fill_total
    c_cnt.border = border_total
    c_cnt.number_format = '#,##0'

    for col in range(6, 8):
        c = ws2.cell(row=curr_row2, column=col, value="")
        c.fill = fill_total
        c.border = border_total

    c_tot2 = ws2.cell(row=curr_row2, column=8, value=f"=SUM(H6:H{curr_row2-1})")
    c_tot2.font = font_bold
    c_tot2.alignment = align_right
    c_tot2.fill = fill_total
    c_tot2.border = border_total
    c_tot2.number_format = 'R$ #,##0.00'

    ws2.cell(row=curr_row2, column=9, value=f"{len(dataset['orders'])} pedidos").font = font_bold
    ws2.cell(row=curr_row2, column=9).alignment = align_center
    ws2.cell(row=curr_row2, column=9).fill = fill_total
    ws2.cell(row=curr_row2, column=9).border = border_total

    for col_idx, (_, _, col_width) in enumerate(analitico_cols, start=1):
        col_letter = get_column_letter(col_idx)
        ws2.column_dimensions[col_letter].width = col_width

    wb.save(output_path)
    print(f"Excel gerado com sucesso em: {output_path}")

class NumberedCanvas(canvas.Canvas):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#64748B"))

        footer_text = "Faça Amigos Brinquedoteca II Ltda — CNPJ: 66.604.382/0001-70 | Shopping Bosque Grão-Pará | Relatório LGPD Compliant"
        page_str = f"Página {self._pageNumber} de {page_count}"

        page_w = 841.89
        self.setStrokeColor(colors.HexColor("#CBD5E1"))
        self.setLineWidth(0.5)
        self.line(30, 25, page_w - 30, 25)

        self.drawString(30, 15, footer_text)
        self.drawRightString(page_w - 30, 15, page_str)

        self.restoreState()

def generate_pdf(dataset, output_path):
    doc = SimpleDocTemplate(
        output_path,
        pagesize=landscape(A4),
        leftMargin=30,
        rightMargin=30,
        topMargin=25,
        bottomMargin=35
    )

    styles = getSampleStyleSheet()

    style_main_title = ParagraphStyle(
        'MainTitle',
        fontName='Helvetica-Bold',
        fontSize=15,
        leading=18,
        textColor=colors.HexColor('#0F172A'),
        alignment=0
    )
    style_subtitle = ParagraphStyle(
        'SubTitle',
        fontName='Helvetica',
        fontSize=8.5,
        leading=11.5,
        textColor=colors.HexColor('#475569'),
        alignment=0
    )
    style_lgpd = ParagraphStyle(
        'LGPDBadge',
        fontName='Helvetica-Bold',
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor('#065F46'),
        alignment=0
    )
    style_section = ParagraphStyle(
        'SectionHdr',
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=14,
        textColor=colors.HexColor('#1E3A8A'),
        spaceBefore=8,
        spaceAfter=4
    )
    style_cell_regular = ParagraphStyle(
        'CellReg',
        fontName='Helvetica',
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor('#1E293B')
    )
    style_cell_center = ParagraphStyle(
        'CellCenter',
        fontName='Helvetica',
        fontSize=7.5,
        leading=9.5,
        alignment=1,
        textColor=colors.HexColor('#1E293B')
    )
    style_cell_bold = ParagraphStyle(
        'CellBold',
        fontName='Helvetica-Bold',
        fontSize=7.5,
        leading=9.5,
        textColor=colors.HexColor('#0F172A')
    )
    style_cell_right_bold = ParagraphStyle(
        'CellRightBold',
        fontName='Helvetica-Bold',
        fontSize=7.5,
        leading=9.5,
        alignment=2,
        textColor=colors.HexColor('#0F172A')
    )
    style_cell_right = ParagraphStyle(
        'CellRight',
        fontName='Helvetica',
        fontSize=7.5,
        leading=9.5,
        alignment=2,
        textColor=colors.HexColor('#1E293B')
    )
    style_th = ParagraphStyle(
        'TableHdr',
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.white,
        alignment=1
    )
    style_th_left = ParagraphStyle(
        'TableHdrLeft',
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.white,
        alignment=0
    )
    style_th_right = ParagraphStyle(
        'TableHdrRight',
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.white,
        alignment=2
    )

    story = []

    # 1. HEADER
    logo_path = 'Logotipo.png'
    info_text = (
        "<b>FACA AMIGOS BRINQUEDOTECA II LTDA</b> | CNPJ: <b>66.604.382/0001-70</b> | IE: <b>75.105.192-6</b><br/>"
        "<b>Estabelecimento:</b> Shopping Bosque Grão-Pará — Av. Centenário, 1052 - Val-de-Cans, Belém/PA - CEP 66635-894<br/>"
        "<b>Unidade:</b> Playground (Bosque Grão-Pará) | <b>Regime:</b> Simples Nacional (CRT 1)<br/>"
        "<b>Período Apurado:</b> 08/10/2026 a 16/10/2026 | <b>Emissão:</b> 16/10/2026 às 12:05 (Horário de Belém/PA)"
    )

    lgpd_header_box = (
        "<b>CONFORMIDADE LGPD (LEI Nº 13.709/2018):</b> Dados pessoais de clientes e identificadores de crianças "
        "foram suprimidos deste relatório de prestação de contas, preservando a privacidade e os direitos fundamentais "
        "dos titulares e de menores (Art. 14 da LGPD)."
    )

    title_block = [
        Paragraph("RELATÓRIO OFICIAL DE VENDAS E APURAÇÃO DE FATURAMENTO", style_main_title),
        Spacer(1, 2),
        Paragraph(info_text, style_subtitle),
        Spacer(1, 2),
        Paragraph(lgpd_header_box, style_lgpd)
    ]

    if os.path.exists(logo_path):
        img = Image(logo_path, width=4.0*cm, height=2.2*cm)
        img.hAlign = 'LEFT'
        header_table = Table([[img, title_block]], colWidths=[4.3*cm, 23.5*cm])
    else:
        header_table = Table([[title_block]], colWidths=[27.8*cm])

    header_table.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0)
    ]))
    story.append(header_table)
    story.append(Spacer(1, 4))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor('#1E3A8A'), spaceBefore=2, spaceAfter=8))

    # 2. KPI CARDS
    total_gross = dataset['total_reais']
    total_orders = dataset['total_orders']
    avg_ticket = total_gross / max(1, total_orders)
    total_items = len(dataset['raw_items'])

    def format_money(val):
        return f"R$ {val:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.')

    card_data = [
        [
            Paragraph("FATURAMENTO BRUTO TOTAL", ParagraphStyle('KL', fontName='Helvetica-Bold', fontSize=8, textColor=colors.HexColor('#475569'), alignment=1)),
            Paragraph("TOTAL DE TRANSAÇÕES", ParagraphStyle('KL', fontName='Helvetica-Bold', fontSize=8, textColor=colors.HexColor('#475569'), alignment=1)),
            Paragraph("TICKET MÉDIO", ParagraphStyle('KL', fontName='Helvetica-Bold', fontSize=8, textColor=colors.HexColor('#475569'), alignment=1)),
            Paragraph("TOTAL DE ITENS / ATENDIMENTOS", ParagraphStyle('KL', fontName='Helvetica-Bold', fontSize=8, textColor=colors.HexColor('#475569'), alignment=1))
        ],
        [
            Paragraph(format_money(total_gross), ParagraphStyle('KV', fontName='Helvetica-Bold', fontSize=14, textColor=colors.HexColor('#1E3A8A'), alignment=1)),
            Paragraph(str(total_orders), ParagraphStyle('KV', fontName='Helvetica-Bold', fontSize=14, textColor=colors.HexColor('#0F172A'), alignment=1)),
            Paragraph(format_money(avg_ticket), ParagraphStyle('KV', fontName='Helvetica-Bold', fontSize=14, textColor=colors.HexColor('#0F172A'), alignment=1)),
            Paragraph(str(total_items), ParagraphStyle('KV', fontName='Helvetica-Bold', fontSize=14, textColor=colors.HexColor('#0F172A'), alignment=1))
        ]
    ]
    card_table = Table(card_data, colWidths=[6.9*cm, 6.9*cm, 6.9*cm, 6.9*cm])
    card_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#F8FAFC')),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
        ('TOPPADDING', (0, 0), (-1, 0), 4),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 2),
        ('TOPPADDING', (0, 1), (-1, 1), 2),
        ('BOTTOMPADDING', (0, 1), (-1, 1), 4),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story.append(card_table)
    story.append(Spacer(1, 8))

    # 3. DEMONSTRATIVO DIÁRIO
    story.append(Paragraph("1. Demonstrativo Diário Consolidado de Vendas (Apuração Shopping)", style_section))

    daily_table_data = [
        [
            Paragraph("Data", style_th),
            Paragraph("Dia da Semana", style_th_left),
            Paragraph("Transações", style_th),
            Paragraph("Crédito (R$)", style_th_right),
            Paragraph("Débito (R$)", style_th_right),
            Paragraph("PIX (R$)", style_th_right),
            Paragraph("Dinheiro (R$)", style_th_right),
            Paragraph("Total Bruto (R$)", style_th_right),
            Paragraph("Ticket Médio", style_th_right),
            Paragraph("% Part.", style_th_right)
        ]
    ]

    sorted_days = sorted(dataset['daily_summary'].keys())
    day_names = dataset['day_names']

    sum_cred = sum(dataset['daily_summary'][d]['credito_cents'] for d in sorted_days) / 100.0
    sum_deb = sum(dataset['daily_summary'][d]['debito_cents'] for d in sorted_days) / 100.0
    sum_pix = sum(dataset['daily_summary'][d]['pix_cents'] for d in sorted_days) / 100.0
    sum_din = sum(dataset['daily_summary'][d]['dinheiro_cents'] for d in sorted_days) / 100.0

    for d_str in sorted_days:
        d_obj = datetime.strptime(d_str, '%Y-%m-%d')
        weekday_name = day_names[d_obj.weekday()]
        d_info = dataset['daily_summary'][d_str]
        d_val = d_info['total_cents'] / 100.0
        d_count = d_info['count']
        tkt = d_val / d_count if d_count > 0 else 0.0
        pct = (d_val / total_gross * 100) if total_gross > 0 else 0.0

        daily_table_data.append([
            Paragraph(d_obj.strftime('%d/%m/%Y'), style_cell_center),
            Paragraph(weekday_name, style_cell_regular),
            Paragraph(str(d_count), style_cell_center),
            Paragraph(f"{d_info['credito_cents']/100.0:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right),
            Paragraph(f"{d_info['debito_cents']/100.0:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right),
            Paragraph(f"{d_info['pix_cents']/100.0:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right),
            Paragraph(f"{d_info['dinheiro_cents']/100.0:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right),
            Paragraph(f"{d_val:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right_bold),
            Paragraph(f"{tkt:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right),
            Paragraph(f"{pct:.1f}%", style_cell_right)
        ])

    daily_table_data.append([
        Paragraph("TOTAL", style_cell_bold),
        Paragraph("Consolidado", style_cell_bold),
        Paragraph(str(total_orders), style_cell_bold),
        Paragraph(f"{sum_cred:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right_bold),
        Paragraph(f"{sum_deb:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right_bold),
        Paragraph(f"{sum_pix:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right_bold),
        Paragraph(f"{sum_din:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right_bold),
        Paragraph(f"{total_gross:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right_bold),
        Paragraph(f"{avg_ticket:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right_bold),
        Paragraph("100.0%", style_cell_right_bold)
    ])

    daily_table = Table(
        daily_table_data,
        colWidths=[2.2*cm, 3.2*cm, 2.2*cm, 2.8*cm, 2.8*cm, 2.8*cm, 2.8*cm, 3.2*cm, 2.8*cm, 2.0*cm]
    )

    t_style = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1E3A8A')),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E2E8F0')),
        ('LINEABOVE', (0, -1), (-1, -1), 1, colors.HexColor('#0F172A')),
    ]
    for r in range(1, len(daily_table_data) - 1):
        if r % 2 == 0:
            t_style.append(('BACKGROUND', (0, r), (-1, r), colors.HexColor('#F8FAFC')))

    daily_table.setStyle(TableStyle(t_style))
    story.append(daily_table)
    story.append(Spacer(1, 8))

    # 4. SÍNTESE E TERMO
    story.append(Paragraph("2. Síntese por Forma de Pagamento e Termo de Conformidade", style_section))

    pay_summary_data = [
        [Paragraph("Forma de Pagamento", style_th_left), Paragraph("Valor Total (R$)", style_th_right), Paragraph("% Part.", style_th_right)]
    ]
    for code, lbl in [('CREDITO', 'Cartão de Crédito'), ('DEBITO', 'Cartão de Débito'), ('PIX', 'PIX'), ('DINHEIRO', 'Dinheiro')]:
        val = dataset['method_totals'].get(code, 0) / 100.0
        pct = (val / total_gross * 100) if total_gross > 0 else 0.0
        pay_summary_data.append([
            Paragraph(lbl, style_cell_regular),
            Paragraph(f"R$ {val:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right),
            Paragraph(f"{pct:.2f}%", style_cell_right)
        ])
    pay_summary_data.append([
        Paragraph("TOTAL", style_cell_bold),
        Paragraph(f"R$ {total_gross:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right_bold),
        Paragraph("100.00%", style_cell_right_bold)
    ])

    pay_table = Table(pay_summary_data, colWidths=[5.5*cm, 4.0*cm, 2.5*cm])
    pay_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0284C7')),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('BACKGROUND', (0, -1), (-1, -1), colors.HexColor('#E2E8F0')),
    ]))

    audit_text = (
        "<b>TERMO DE CONFORMIDADE E DECLARAÇÃO DO LOCATÁRIO (LGPD COMPLIANT):</b><br/>"
        "Declaramos à administração e auditoria do <b>Shopping Bosque Grão-Pará</b> que as informações contidas "
        "neste relatório compreendem a totalidade das operações mercantis e prestações de serviços realizadas "
        "pelo estabelecimento <b>FAÇA AMIGOS BRINQUEDOTECA II LTDA</b> (CNPJ 66.604.382/0001-70) no período de "
        "<b>08/10/2026 a 16/10/2026</b>.<br/>"
        "Em atendimento aos princípios da finalidade, necessidade e adequação da Lei Geral de Proteção de Dados "
        "(Lei nº 13.709/2018), foram suprimidos dados pessoais de clientes e de menores de idade, mantendo-se "
        "a integridade das métricas financeiras, quantitativas e operacionais para fins de apuração contratual.<br/><br/>"
        "________________________________________ &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; ________________________________________<br/>"
        "<b>FAÇA AMIGOS BRINQUEDOTECA II LTDA</b> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; <b>AUDITORIA / ADM. SHOPPING BOSQUE GRÃO-PARÁ</b>"
    )
    audit_para = Paragraph(audit_text, ParagraphStyle('AuditPara', fontName='Helvetica', fontSize=7.2, leading=9.5, textColor=colors.HexColor('#334155')))

    side_by_side = Table([[pay_table, audit_para]], colWidths=[12.5*cm, 15.1*cm])
    side_by_side.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (1, 0), (1, 0), 12),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(side_by_side)

    # 5. TRANSACTIONS DETAIL (PAGE BREAK)
    story.append(PageBreak())
    story.append(Paragraph("3. Detalhamento Analítico de Vendas (LGPD Compliant — Sem Dados Pessoais)", style_section))
    story.append(Paragraph("Demonstrativo transação a transação com descrições operacionais e financeiras sanitizadas:", style_subtitle))
    story.append(Spacer(1, 4))

    tx_table_data = [
        [
            Paragraph("Nº Pedido / Cupom", style_th),
            Paragraph("Data/Hora", style_th),
            Paragraph("Descrição do Serviço / Produto (Sanitizado)", style_th_left),
            Paragraph("Itens", style_th),
            Paragraph("Operador PDV", style_th_left),
            Paragraph("Forma Pagamento", style_th_left),
            Paragraph("Valor (R$)", style_th_right),
            Paragraph("Status", style_th)
        ]
    ]

    for o in dataset['orders']:
        tx_table_data.append([
            Paragraph(o['order_code'], style_cell_center),
            Paragraph(o['local_datetime_str'], style_cell_center),
            Paragraph(o['items_desc'][:60], style_cell_regular),
            Paragraph(str(o['items_count']), style_cell_center),
            Paragraph(o['operator'][:22], style_cell_regular),
            Paragraph(o['payment_methods_str'][:26], style_cell_regular),
            Paragraph(f"{o['total_reais']:,.2f}".replace(',', 'X').replace('.', ',').replace('X', '.'), style_cell_right),
            Paragraph(o['status'], style_cell_center)
        ])

    tx_table = Table(
        tx_table_data,
        colWidths=[3.2*cm, 3.2*cm, 8.4*cm, 1.4*cm, 3.8*cm, 3.8*cm, 2.2*cm, 1.8*cm],
        repeatRows=1
    )

    tx_style = [
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#1E3A8A')),
        ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1')),
        ('INNERGRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E2E8F0')),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]
    for r in range(1, len(tx_table_data)):
        if r % 2 == 0:
            tx_style.append(('BACKGROUND', (0, r), (-1, r), colors.HexColor('#F8FAFC')))

    tx_table.setStyle(TableStyle(tx_style))
    story.append(tx_table)

    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"PDF gerado com sucesso em: {output_path}")

def main():
    data = load_data()
    dataset = build_dataset(data)

    excel_path = "Relatorio_Vendas_Playground_Grao_Para_08_a_16_Out_2026.xlsx"
    pdf_path = "Relatorio_Vendas_Playground_Grao_Para_08_a_16_Out_2026.pdf"

    generate_excel(dataset, excel_path)
    generate_pdf(dataset, pdf_path)

if __name__ == '__main__':
    main()
