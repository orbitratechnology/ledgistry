"use client";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type Common = {
  name: string;
  label: string;
  error?: string;
  description?: string;
  defaultValue?: string;
  required?: boolean;
};

const describedBy = (name: string, error?: string, description?: string) =>
  [error ? `${name}-error` : null, description ? `${name}-description` : null]
    .filter(Boolean)
    .join(" ") || undefined;

/** Labelled input with its error associated through aria-describedby. */
export function TextField({
  name,
  label,
  error,
  description,
  defaultValue,
  required,
  type = "text",
  inputMode,
  placeholder,
  autoComplete = "off",
}: Common & {
  type?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={name}>
        {label}
        {required ? null : <span className="font-normal text-muted-foreground">(optional)</span>}
      </FieldLabel>
      <Input
        id={name}
        name={name}
        type={type}
        inputMode={inputMode}
        placeholder={placeholder}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, error, description)}
        className="h-10 md:h-9"
      />
      {description ? <FieldDescription id={`${name}-description`}>{description}</FieldDescription> : null}
      {error ? <FieldError id={`${name}-error`}>{error}</FieldError> : null}
    </Field>
  );
}

export function TextAreaField({ name, label, error, description, defaultValue }: Common) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={name}>
        {label} <span className="font-normal text-muted-foreground">(optional)</span>
      </FieldLabel>
      <Textarea
        id={name}
        name={name}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, error, description)}
        rows={3}
      />
      {description ? <FieldDescription id={`${name}-description`}>{description}</FieldDescription> : null}
      {error ? <FieldError id={`${name}-error`}>{error}</FieldError> : null}
    </Field>
  );
}

export function SelectField({
  name,
  label,
  error,
  description,
  defaultValue,
  required,
  options,
  placeholder,
  disabled,
  onValueChange,
}: Common & {
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
  onValueChange?: (value: string) => void;
}) {
  return (
    <Field data-invalid={error ? true : undefined} data-disabled={disabled ? true : undefined}>
      <FieldLabel htmlFor={name}>
        {label}
        {required ? null : <span className="font-normal text-muted-foreground">(optional)</span>}
      </FieldLabel>
      <NativeSelect
        id={name}
        name={name}
        defaultValue={defaultValue ?? ""}
        onChange={onValueChange ? (event) => onValueChange(event.target.value) : undefined}
        required={required}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(name, error, description)}
        className="w-full *:h-10 md:*:h-9"
      >
        {placeholder !== undefined ? <NativeSelectOption value="">{placeholder}</NativeSelectOption> : null}
        {options.map((option) => (
          <NativeSelectOption key={option.value} value={option.value}>
            {option.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {description ? <FieldDescription id={`${name}-description`}>{description}</FieldDescription> : null}
      {error ? <FieldError id={`${name}-error`}>{error}</FieldError> : null}
    </Field>
  );
}
