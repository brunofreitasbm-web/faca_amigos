"use client";

import { Button } from "@/components/design-system";
import type { ClosedPayrollItem } from "./FolhaPagamentoTable";

interface PayrollCsvDownloadButtonProps {
  items: ClosedPayrollItem[];
  filenameSuffix: string;
}

/**
 * Mesmo padrão de export usado em relatorios/ReportFilters.tsx (data URI +
 * link temporário, sem dependência de xlsx). Esta planilha é um relatório de
 * conferência/fechamento — o Bradesco Net Empresa (Multipag) não aceita
 * upload direto de Excel/CSV para pagamento de salários, só CNAB240.
 */
export function PayrollCsvDownloadButton({ items, filenameSuffix }: PayrollCsvDownloadButtonProps) {
  function handleDownload() {
    const rows = [
      ["Nome", "CPF", "Banco", "Agência", "Agência DV", "Conta", "Conta DV", "Tipo de Conta", "Valor (R$)"],
      ...items.map((item) => [
        item.full_name_snapshot,
        item.cpf_snapshot ?? "",
        item.bank_code_snapshot ?? "",
        item.bank_agencia_snapshot ?? "",
        item.bank_agencia_dv_snapshot ?? "",
        item.bank_conta_snapshot ?? "",
        item.bank_conta_dv_snapshot ?? "",
        item.bank_account_type_snapshot ?? "",
        (item.total_cents / 100).toFixed(2),
      ]),
    ];

    const csvContent = "data:text/csv;charset=utf-8," + rows.map((r) => r.join(";")).join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `folha_pagamento_${filenameSuffix}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <Button type="button" variant="teal" size="sm" onClick={handleDownload}>
      Baixar planilha
    </Button>
  );
}
