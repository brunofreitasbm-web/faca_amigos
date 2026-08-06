import { useEffect, useState } from "react";
import type { CSSProperties, InputHTMLAttributes } from "react";
import { dateBrFromIso, formatDateBr, isValidDateBr, isoFromDateBr } from "@facaamigos/domain";
import { Input } from "./Input.js";

export interface DateInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "style" | "value" | "onChange" | "type" | "defaultValue"> {
  label?: string;
  /** ISO (AAAA-MM-DD). Informar torna o campo controlado. */
  value?: string;
  /** ISO inicial quando o campo é não-controlado (formulários com FormData). */
  defaultValue?: string;
  /** Recebe ISO (AAAA-MM-DD), ou "" enquanto a data estiver incompleta/inválida. */
  onChange?: (iso: string) => void;
  /**
   * Quando informado, um input oculto com esse `name` carrega o ISO — é o
   * que faz o campo funcionar dentro de um `<form>` lido por FormData
   * (o padrão do backoffice) sem precisar de estado no componente pai.
   */
  name?: string;
  /** Erro externo. Data inválida já é detectada internamente. */
  error?: string;
  variant?: "light" | "dark";
  style?: CSSProperties;
}

/**
 * Campo de data digitável (DD/MM/AAAA) no lugar de `<input type="date">`.
 *
 * No celular o input nativo de data não aceita digitação — abre o seletor
 * e obriga a navegar mês a mês, o que é lento justamente onde mais dói:
 * a data de nascimento no check-in, que costuma estar anos atrás. Aqui é
 * um campo de texto com teclado numérico e máscara, então o operador
 * simplesmente digita oito dígitos.
 *
 * O contrato para fora continua sendo ISO — quem consome nunca vê o
 * formato brasileiro, que é só a representação de tela.
 */
export function DateInput({
  label,
  value,
  defaultValue,
  onChange,
  name,
  error,
  placeholder,
  ...rest
}: DateInputProps) {
  const isControlled = value !== undefined;
  const [text, setText] = useState(() => dateBrFromIso((isControlled ? value : defaultValue) ?? ""));

  // Ressincroniza só quando o ISO de fora divergir do que o texto atual
  // produz. Sem essa comparação, o `onChange("")` que acontece a cada
  // tecla de uma data incompleta voltaria aqui e apagaria o que está
  // sendo digitado.
  useEffect(() => {
    if (!isControlled) return;
    if (isoFromDateBr(text) !== value) setText(dateBrFromIso(value ?? ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const iso = isoFromDateBr(text);

  return (
    <>
      <Input
        label={label}
        // Texto, não `type="date"`: é o que mantém o campo digitável no celular.
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        placeholder={placeholder ?? "DD/MM/AAAA"}
        value={text}
        onChange={(e) => {
          const masked = formatDateBr(e.target.value);
          setText(masked);
          onChange?.(isoFromDateBr(masked));
        }}
        error={error ?? (text.length === 10 && !isValidDateBr(text) ? "Data inválida" : undefined)}
        {...rest}
      />
      {name && <input type="hidden" name={name} value={iso} />}
    </>
  );
}
