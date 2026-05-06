export interface TemplateValues {
  basename: string;
  filename: string;
  path: string;
  width: string;
}

export function renderLatexTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\$\{(basename|filename|path|width)\}/g, (_match, key: keyof TemplateValues) => {
    return values[key];
  });
}
