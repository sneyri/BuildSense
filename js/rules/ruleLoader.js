// Загрузка машиночитаемых правил из data/rules (index.json + файлы правил).
import { validateRule } from "./checker.js";

/**
 * @param {string} baseUrl путь к папке правил, например "data/rules/"
 * @param {(url: string) => Promise<any>} [fetchJson] — подменяется в тестах
 * @returns {Promise<{ rules: object[], errors: string[], files: string[] }>}
 */
export async function loadRules(baseUrl = "data/rules/", fetchJson = defaultFetchJson) {
  const errors = [];
  const rules = [];
  const ids = new Set();

  const index = await fetchJson(`${baseUrl}index.json`);
  const files = Array.isArray(index.files) ? index.files : [];
  if (!files.length) errors.push("index.json: список файлов правил пуст");

  for (const file of files) {
    let data;
    try {
      data = await fetchJson(`${baseUrl}${file}`);
    } catch (err) {
      errors.push(`${file}: ${err.message}`);
      continue;
    }
    for (const rule of Array.isArray(data.rules) ? data.rules : []) {
      const problems = validateRule(rule);
      if (rule && ids.has(rule.id)) problems.push("повторяющийся id");
      if (problems.length) {
        errors.push(`${file} → ${rule?.id || "без id"}: ${problems.join("; ")}`);
        continue;
      }
      ids.add(rule.id);
      rules.push({ ...rule, sourceFile: file });
    }
  }
  return { rules, errors, files };
}

async function defaultFetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`не удалось загрузить ${url} (HTTP ${response.status})`);
  try {
    return await response.json();
  } catch (err) {
    throw new Error(`ошибка JSON в ${url}: ${err.message}`);
  }
}
