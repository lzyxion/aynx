/**
 * 다중 고르개의 순수 규칙 — 손잡이 글자와 고른 값의 정규화·토글.
 * DOM·룬·번역은 부품/호출부 몫이고, 자리·타이프어헤드는 dropdown.ts 를 쓴다.
 */
export interface MultiDropdownOption<V extends string = string> {
  value: V;
  label: string;
  hint?: string;
  disabled?: boolean;
}

/** 목록 순서로 중복을 걷는다. 목록 밖 값은 호출부가 옵션으로 남겨야 보존된다. */
export function normalizeMultiValues<V extends string>(
  options: readonly MultiDropdownOption<V>[],
  values: readonly V[],
): V[] {
  const selected = new Set(values);
  const seen = new Set<V>();
  return options.filter((o) => {
    if (!selected.has(o.value) || seen.has(o.value)) return false;
    seen.add(o.value);
    return true;
  }).map((o) => o.value);
}

/** 비활성/없는 항목은 토글하지 않는다. 이미 고른 비활성 항목은 보존한다. */
export function toggleMultiValue<V extends string>(
  options: readonly MultiDropdownOption<V>[],
  values: readonly V[],
  value: V,
): V[] {
  const current = normalizeMultiValues(options, values);
  const option = options.find((o) => o.value === value);
  if (!option || option.disabled) return current;
  const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
  return normalizeMultiValues(options, next);
}

/** 둘까지는 라벨을 잇고 셋부터는 호출부의 개수 문구를 쓴다. */
export function multiDropdownLabel<V extends string>(
  options: readonly MultiDropdownOption<V>[],
  values: readonly V[],
  placeholder: string,
  placeholderMany: (count: number) => string,
): string {
  const selected = normalizeMultiValues(options, values);
  if (selected.length === 0) return placeholder;
  if (selected.length > 2) return placeholderMany(selected.length);
  return selected.map((value) => options.find((o) => o.value === value)!.label).join(", ");
}
