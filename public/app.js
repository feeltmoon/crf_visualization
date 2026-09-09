(() => {
  "use strict";

  let study = window.CRF_STUDY;
  if (!study) {
    document.body.innerHTML = '<main class="fatal-error"><h1>Study data could not be loaded.</h1><p>Keep study-data.js beside index.html.</p></main>';
    return;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const truthy = (value) => String(value ?? "").toUpperCase() === "TRUE";
  const cleanText = (value) => {
    const source = String(value ?? "").replace(/_x000D_/gi, " ").replace(/&nbsp;/gi, " ");
    const parsed = new DOMParser().parseFromString(`<body>${source}</body>`, "text/html");
    return parsed.body.textContent.replace(/\s+/g, " ").trim();
  };
  const scalar = (value) => {
    const text = String(value ?? "").trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
    if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
    if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
    if (/^null$/i.test(text)) return null;
    return text;
  };
  const isInactive = (row, nameKey) => !truthy(row[nameKey]) || /_INACTIVE\b/i.test(String(row.DraftFieldName || row.DraftFormName || ""));
  const isTechnical = (field) => Number(field.Ordinal) >= 100 || /programming purpose|\bderived\b|current\s*date\s*time|^RSG\s*-/i.test(cleanText(field.PreText)) || ["FRMID", "AEESTDAT"].includes(String(field.FieldOID));
  const themeKey = "formcraft-theme";
  const supportedThemes = new Set(["soft", "coral"]);
  const supportedDynamicOperators = new Set(["equals", "not_equals", "in", "not_in", "contains", "is_blank", "is_not_blank"]);
  const supportedDynamicActions = new Set(["show", "hide", "disable", "clear"]);
  let savedTheme = "soft";
  try { savedTheme = localStorage.getItem(themeKey) || "soft"; } catch (_) { /* file:// storage can be unavailable */ }
  if (!supportedThemes.has(savedTheme)) {
    savedTheme = "soft";
    try { localStorage.setItem(themeKey, savedTheme); } catch (_) { /* keep the fallback in memory */ }
  }
  document.documentElement.dataset.theme = savedTheme;

  let formsByOid;
  let fieldsByForm;
  let dictionaries;

  function indexStudy(nextStudy) {
    study = nextStudy;
    formsByOid = new Map(study.forms.map((form) => [String(form.OID), form]));
    fieldsByForm = new Map();
    for (const field of study.fields) {
      const oid = String(field.FormOID);
      if (!fieldsByForm.has(oid)) fieldsByForm.set(oid, []);
      fieldsByForm.get(oid).push(field);
    }
    for (const fields of fieldsByForm.values()) fields.sort((a, b) => Number(a.Ordinal || 0) - Number(b.Ordinal || 0));
    dictionaries = new Map();
    for (const entry of study.dictionaryEntries) {
      const name = String(entry.DataDictionaryName);
      if (!dictionaries.has(name)) dictionaries.set(name, []);
      dictionaries.get(name).push(entry);
    }
    for (const entries of dictionaries.values()) entries.sort((a, b) => Number(a.Ordinal || 0) - Number(b.Ordinal || 0));
  }

  indexStudy(study);

  const refs = {
    globalSearch: $("#globalSearch"), formList: $("#formList"), studyName: $("#studyName"), sourceFile: $("#sourceFile"),
    formCount: $("#formCount"), fieldCount: $("#fieldCount"), dictionaryCount: $("#dictionaryCount"), formTitle: $("#formTitle"),
    formOid: $("#formOid"), formMeta: $("#formMeta"), formCanvas: $("#formCanvas"), fieldSearch: $("#fieldSearch"),
    visibleFieldCount: $("#visibleFieldCount"), inactiveFormsButton: $("#inactiveFormsButton"), inactiveFieldsButton: $("#inactiveFieldsButton"),
    technicalFieldsButton: $("#technicalFieldsButton"), metadataButton: $("#metadataButton"), resetButton: $("#resetButton"),
    printButton: $("#printButton"), printPreviewBar: $("#printPreviewBar"), printNowButton: $("#printNowButton"), closePrintPreview: $("#closePrintPreview"),
    rulesButton: $("#rulesButton"), openRulesInline: $("#openRulesInline"), rulesDialog: $("#rulesDialog"),
    rulesEditor: $("#rulesEditor"), rulesFile: $("#rulesFile"), applyRulesButton: $("#applyRulesButton"), ruleStatus: $("#ruleStatus"),
    ruleCount: $("#ruleCount"), ruleBanner: $("#ruleBanner"), ruleBannerTitle: $("#ruleBannerTitle"), ruleBannerText: $("#ruleBannerText"),
    inspector: $("#inspector"), inspectorOid: $("#inspectorOid"), inspectorBody: $("#inspectorBody"), closeInspector: $("#closeInspector"),
    scrim: $("#scrim"), toast: $("#toast"), themeSelect: $("#themeSelect"),
  };

  const state = {
    selectedForm: formsByOid.has(location.hash.slice(1)) ? location.hash.slice(1) : (formsByOid.has("AE_MIX") ? "AE_MIX" : study.forms.find((form) => !isInactive(form, "DraftFormActive"))?.OID),
    formQuery: "", fieldQuery: "", showInactiveForms: false, showInactiveFields: false, showTechnical: false, showMetadata: false,
    parsedRules: { form: null, version: 1, rules: [] }, rulesYaml: window.CRF_RULES_YAML || "", logRecordSerial: 0,
  };

  function parseRulesYaml(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return { form: null, version: 1, rules: [] };
    if (trimmed.startsWith("{")) return validateRules(JSON.parse(trimmed));
    const output = { form: null, version: 1, rules: [] };
    let rule = null;
    let section = null;
    let listKey = null;
    for (const raw of trimmed.replace(/\r/g, "").split("\n")) {
      if (!raw.trim() || raw.trimStart().startsWith("#")) continue;
      const indent = raw.length - raw.trimStart().length;
      const line = raw.trim();
      if (indent === 0 && line.startsWith("form:")) output.form = scalar(line.slice(5));
      else if (indent === 0 && line.startsWith("version:")) output.version = scalar(line.slice(8));
      else if (indent === 2 && line.startsWith("- id:")) {
        rule = { id: scalar(line.slice(5)), description: "", form: output.form, when: {}, then: {}, otherwise: {} };
        output.rules.push(rule); section = null; listKey = null;
      } else if (rule && indent === 4 && line.startsWith("description:")) rule.description = scalar(line.slice(12));
      else if (rule && indent === 4 && line.startsWith("form:")) rule.form = scalar(line.slice(5));
      else if (rule && indent === 4 && /^(when|then|otherwise):$/.test(line)) { section = line.slice(0, -1); listKey = null; }
      else if (rule && section === "when" && indent === 6 && line.includes(":")) {
        const split = line.indexOf(":");
        const key = line.slice(0, split).trim(); const value = line.slice(split + 1).trim();
        if (value) rule.when[key] = scalar(value); else { rule.when[key] = []; listKey = key; }
      } else if (rule && ["then", "otherwise"].includes(section) && indent === 6 && line.includes(":")) {
        const split = line.indexOf(":");
        listKey = line.slice(0, split).trim();
        const value = line.slice(split + 1).trim();
        if (!supportedDynamicActions.has(listKey)) throw new Error(`Unsupported dynamic action: ${listKey}. IsRequired is read from ALS metadata, not YAML.`);
        if (!value) rule[section][listKey] = [];
        else if (value.startsWith("[") && value.endsWith("]")) rule[section][listKey] = value.slice(1, -1).split(",").map(scalar).filter((item) => String(item).trim());
        else throw new Error(`Dynamic action ${listKey} must be a YAML list.`);
      } else if (rule && listKey && indent >= 8 && line.startsWith("- ")) {
        const target = section === "when" ? rule.when[listKey] : rule[section][listKey];
        target.push(scalar(line.slice(2)));
      }
    }
    return validateRules(output);
  }

  function validateRules(output) {
    if (!output || !Array.isArray(output.rules)) throw new Error("Rules must contain a rules list.");
    for (const candidate of output.rules) {
      if (!candidate.id || !candidate.when?.field || !candidate.when?.operator) throw new Error("Every rule needs id, when.field, and when.operator.");
      if (!supportedDynamicOperators.has(String(candidate.when.operator))) throw new Error(`Unsupported dynamic operator: ${candidate.when.operator}.`);
      for (const branchName of ["then", "otherwise"]) {
        const branch = candidate[branchName] || {};
        candidate[branchName] = branch;
        for (const [action, targets] of Object.entries(branch)) {
          if (!supportedDynamicActions.has(action)) throw new Error(`Unsupported dynamic action: ${action}. IsRequired is read from ALS metadata, not YAML.`);
          if (!Array.isArray(targets)) throw new Error(`Dynamic action ${action} must be a list.`);
        }
      }
    }
    return output;
  }

  function yamlScalar(value) {
    if (value === null) return "null";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(String(value ?? ""));
  }

  function serializeRulesYaml(document) {
    const rules = document.rules || [];
    const forms = new Set(rules.map((rule) => rule.form).filter((form) => form !== null && form !== undefined && String(form) !== "").map(String));
    const commonForm = forms.size === 1 && rules.every((rule) => String(rule.form ?? "") === [...forms][0]) ? [...forms][0] : null;
    const lines = [];
    if (commonForm) lines.push(`form: ${yamlScalar(commonForm)}`);
    lines.push(`version: ${Number(document.version) || 1}`, "rules:");
    const appendValues = (indent, key, value) => {
      if (Array.isArray(value)) {
        if (!value.length) lines.push(`${indent}${key}: []`);
        else { lines.push(`${indent}${key}:`); for (const item of value) lines.push(`${indent}  - ${yamlScalar(item)}`); }
      } else lines.push(`${indent}${key}: ${yamlScalar(value)}`);
    };
    for (const rule of rules) {
      lines.push(`  - id: ${yamlScalar(rule.id)}`);
      if (rule.description) lines.push(`    description: ${yamlScalar(rule.description)}`);
      if (!commonForm && rule.form !== null && rule.form !== undefined && String(rule.form) !== "") lines.push(`    form: ${yamlScalar(rule.form)}`);
      lines.push("    when:");
      for (const [key, value] of Object.entries(rule.when || {})) appendValues("      ", key, value);
      for (const branchName of ["then", "otherwise"]) {
        lines.push(`    ${branchName}:`);
        for (const [action, targets] of Object.entries(rule[branchName] || {})) appendValues("      ", action, targets);
      }
    }
    return `${lines.join("\n")}\n`;
  }

  function mergeRuleDocuments(current, incoming) {
    const rules = [...current.rules];
    const indexes = new Map(rules.map((rule, index) => [`${String(rule.form ?? "")}::${String(rule.id)}`, index]));
    let added = 0; let updated = 0; let unchanged = 0;
    for (const rule of incoming.rules) {
      const key = `${String(rule.form ?? "")}::${String(rule.id)}`;
      if (!indexes.has(key)) { indexes.set(key, rules.length); rules.push(rule); added += 1; continue; }
      const index = indexes.get(key);
      if (JSON.stringify(rules[index]) === JSON.stringify(rule)) unchanged += 1;
      else { rules[index] = rule; updated += 1; }
    }
    const forms = new Set(rules.map((rule) => rule.form).filter((form) => form !== null && form !== undefined && String(form) !== "").map(String));
    return {
      document: { form: forms.size === 1 ? [...forms][0] : null, version: Math.max(Number(current.version) || 1, Number(incoming.version) || 1), rules },
      added, updated, unchanged,
    };
  }

  function formRules(oid = state.selectedForm) {
    return state.parsedRules.rules.filter((rule) => !rule.form || String(rule.form) === String(oid));
  }

  function targetFieldsForForm(oid) {
    const targets = new Set();
    for (const rule of formRules(oid)) {
      for (const branch of [rule.then, rule.otherwise]) for (const list of Object.values(branch || {})) for (const field of list || []) targets.add(String(field));
    }
    return targets;
  }

  function triggerFieldsForForm(oid) {
    return new Set(formRules(oid).map((rule) => String(rule.when.field)));
  }

  function dynamicDepthsForForm(oid) {
    const rules = formRules(oid);
    const triggers = new Set();
    const targets = new Set();
    const edges = [];
    for (const rule of rules) {
      const from = String(rule.when.field);
      triggers.add(from);
      const ruleTargets = new Set();
      for (const branch of [rule.then, rule.otherwise]) for (const list of Object.values(branch || {})) for (const field of list || []) ruleTargets.add(String(field));
      for (const target of ruleTargets) { targets.add(target); edges.push([from, target]); }
    }
    const depths = new Map([...triggers].filter((field) => !targets.has(field)).map((field) => [field, 0]));
    const propagate = () => {
      for (let pass = 0; pass <= edges.length; pass += 1) {
        let changed = false;
        for (const [from, target] of edges) {
          if (!depths.has(from)) continue;
          const candidate = depths.get(from) + 1;
          if (!depths.has(target) || candidate < depths.get(target)) { depths.set(target, candidate); changed = true; }
        }
        if (!changed) break;
      }
    };
    propagate();
    for (const trigger of triggers) if (!depths.has(trigger)) depths.set(trigger, 0);
    propagate();
    return depths;
  }

  function renderSidebar() {
    refs.formList.replaceChildren();
    const query = state.formQuery.toLowerCase();
    const forms = study.forms.filter((form) => {
      if (!state.showInactiveForms && isInactive(form, "DraftFormActive")) return false;
      return !query || `${form.OID} ${form.DraftFormName}`.toLowerCase().includes(query);
    });
    if (!forms.length) {
      const empty = document.createElement("div"); empty.className = "nav-empty"; empty.textContent = "No forms match your search."; refs.formList.append(empty); return;
    }
    for (const form of forms) {
      const button = document.createElement("button");
      button.type = "button"; button.className = `form-link${String(form.OID) === String(state.selectedForm) ? " active" : ""}`;
      button.dataset.formOid = form.OID;
      const inactive = isInactive(form, "DraftFormActive");
      button.innerHTML = `<span class="form-label"><strong></strong><small></small></span>${inactive ? '<i class="inactive-dot" title="Inactive form"></i>' : ""}`;
      $("strong", button).textContent = cleanText(form.DraftFormName) || form.OID;
      $("small", button).textContent = form.OID;
      refs.formList.append(button);
    }
  }

  function chip(text, className = "") {
    const span = document.createElement("span"); span.className = `meta-chip ${className}`.trim(); span.textContent = text; return span;
  }

  function fieldTag(text, className = "") {
    const span = document.createElement("span"); span.className = `tag ${className}`.trim(); span.textContent = text; return span;
  }

  function fieldLabel(field) { return cleanText(field.PreText) || cleanText(field.HeaderText) || cleanText(field.SASLabel) || String(field.FieldOID); }
  function dictionaryFor(field) { return dictionaries.get(String(field.DataDictionaryName || "")) || []; }
  function delimitedDefaults(field) {
    const value = String(field.DefaultValue ?? "");
    return value.includes("|") ? value.split("|").map((item) => item.trim()).filter(Boolean) : [];
  }
  function formProfile(fields) {
    const logFields = fields.filter((field) => truthy(field.IsLog));
    const hasLog = logFields.length > 0;
    const hasNonLog = fields.some((field) => !truthy(field.IsLog));
    const fixedSeedFields = logFields.filter((field) => String(field.DefaultValue ?? "").includes("|"));
    if (!hasLog) return { kind: "single", label: "Single form", canvasLabel: "Single record", logFields, fixedSeedFields, rowCount: 0 };
    if (!hasNonLog) return { kind: "repeating", label: "Repeating logs", canvasLabel: "Repeating logs", logFields, fixedSeedFields: [], rowCount: 0 };
    if (!fixedSeedFields.length) return { kind: "mixed-repeating", label: "Mixed + repeating logs", canvasLabel: "Mixed + repeating logs", logFields, fixedSeedFields, rowCount: 0 };
    const rowCount = Math.max(...fixedSeedFields.map((field) => delimitedDefaults(field).length), 1);
    return { kind: "mixed-fixed", label: "Mixed + fixed logs", canvasLabel: "Mixed + fixed logs", logFields, fixedSeedFields, rowCount };
  }
  function applyDefault(input, field, isLog) {
    if (isLog || field.DefaultValue === null || field.DefaultValue === undefined || String(field.DefaultValue) === "") return;
    if (input.type === "checkbox" || input.type === "radio") input.checked = String(input.value) === String(field.DefaultValue) || truthy(field.DefaultValue);
    else input.value = String(field.DefaultValue);
  }

  function createControl(field, { isLog = false, recordId = "fixed" } = {}) {
    const wrap = document.createElement("div"); wrap.className = "control-inner";
    const type = String(field.ControlType || "Text"); const options = dictionaryFor(field); const label = fieldLabel(field);
    const setCommon = (input) => {
      input.dataset.fieldInput = field.FieldOID; input.dataset.codedName = field.VariableOID || field.FieldOID;
      input.setAttribute("aria-label", label); applyDefault(input, field, isLog); return input;
    };
    if (/RadioButton/i.test(type) && options.length) {
      wrap.className = `choice-group${/Vertical/i.test(type) ? " vertical" : ""}`;
      for (const option of options) {
        const choice = document.createElement("label"); choice.className = "choice";
        const input = setCommon(document.createElement("input")); input.type = "radio"; input.name = `${recordId}__${field.FieldOID}`; input.value = option.CodedData;
        choice.append(input, document.createTextNode(option.UserDataString || option.CodedData)); wrap.append(choice);
      }
      return wrap;
    }
    if (/DropDownList/i.test(type)) {
      const select = setCommon(document.createElement("select"));
      const placeholder = new Option("Select…", ""); select.append(placeholder);
      for (const option of options) select.append(new Option(option.UserDataString || option.CodedData, option.CodedData));
      wrap.append(select); return wrap;
    }
    if (/CheckBox/i.test(type)) {
      const choice = document.createElement("label"); choice.className = "checkbox-control";
      const input = setCommon(document.createElement("input")); input.type = "checkbox"; input.value = "true";
      choice.append(input, document.createTextNode("Selected")); wrap.append(choice); return wrap;
    }
    if (/LongText/i.test(type)) {
      const textarea = setCommon(document.createElement("textarea")); textarea.rows = isLog ? 2 : 3; wrap.append(textarea); return wrap;
    }
    const input = setCommon(document.createElement("input"));
    input.type = /SearchList/i.test(type) ? "search" : "text";
    input.placeholder = /DateTime/i.test(type) ? String(field.DataFormat || "dd MMM yyyy") : (/SearchList/i.test(type) ? "Search or enter value" : String(field.DataFormat || ""));
    const length = String(field.DataFormat || "").match(/^\$(\d+)$/)?.[1]; if (length) input.maxLength = Number(length);
    if (field.FixedUnit) {
      wrap.className = "input-with-unit"; const unit = document.createElement("span"); unit.className = "unit"; unit.textContent = field.FixedUnit; wrap.append(input, unit);
    } else wrap.append(input);
    return wrap;
  }

  function inspectIconButton(field) {
    const button = document.createElement("button"); button.type = "button"; button.className = "inspect-button"; button.dataset.inspectField = field.FieldOID; button.title = `Inspect ${field.FieldOID}`; button.setAttribute("aria-label", `Inspect ${field.FieldOID}`);
    button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 10.5v6m0-9.5v.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>';
    return button;
  }

  function appendFieldTags(container, field, dynamicTargets) {
    if (truthy(field.IsRequired)) container.append(fieldTag("Required", "tag-required"));
    if (isTechnical(field)) container.append(fieldTag("Technical", "tag-technical"));
    if (isInactive(field, "DraftFieldActive")) container.append(fieldTag("Inactive", "tag-inactive"));
    if (dynamicTargets.has(String(field.FieldOID))) container.append(fieldTag("Dynamic", "tag-dynamic"));
  }

  function createMetadata(field) {
    const meta = document.createElement("div"); meta.className = "field-metadata";
    for (const [label, value] of [["FieldOID", field.FieldOID], ["VariableOID", field.VariableOID || "—"], ["ControlType", field.ControlType], ["DataFormat", field.DataFormat || "—"], ["Dictionary", field.DataDictionaryName || "—"], ["IsLog", field.IsLog || "FALSE"]]) {
      const span = document.createElement("span"); span.textContent = `${label}: ${value}`; meta.append(span);
    }
    return meta;
  }

  function createFieldRow(field, index, dynamicTargets) {
    const labelOnly = !field.VariableOID && /^Text$/i.test(String(field.ControlType || ""));
    const row = document.createElement("article"); row.className = `field-row${labelOnly ? " label-field" : ""}${isInactive(field, "DraftFieldActive") ? " is-inactive" : ""}`;
    row.dataset.fieldOid = field.FieldOID; row.dataset.baseRequired = String(truthy(field.IsRequired)); row.style.setProperty("--index", index);
    const copy = document.createElement("div"); copy.className = "field-copy";
    const label = document.createElement("span"); label.className = "field-label"; label.textContent = fieldLabel(field);
    if (truthy(field.IsRequired) && !labelOnly) { const star = document.createElement("span"); star.className = "required-star"; star.textContent = "*"; label.append(star); }
    const tags = document.createElement("div"); tags.className = "field-subline"; appendFieldTags(tags, field, dynamicTargets); copy.append(label, tags);
    row.append(copy);
    if (!labelOnly) { const control = document.createElement("div"); control.className = "field-control"; control.append(createControl(field)); row.append(control); }
    row.append(inspectIconButton(field), createMetadata(field));
    return row;
  }

  function createLogCell(field, recordId, dynamicTargets, presetValue) {
    const cell = document.createElement("div"); cell.className = "log-cell"; cell.dataset.fieldOid = field.FieldOID; cell.dataset.baseRequired = String(truthy(field.IsRequired));
    const label = document.createElement("label"); label.textContent = fieldLabel(field);
    if (truthy(field.IsRequired)) { const star = document.createElement("span"); star.className = "required-star"; star.textContent = "*"; label.append(star); }
    const tags = document.createElement("div"); tags.className = "field-subline"; appendFieldTags(tags, field, dynamicTargets);
    let control;
    if (presetValue !== undefined) {
      control = document.createElement("div"); control.className = "fixed-log-value";
      const value = document.createElement("strong"); value.textContent = presetValue;
      const lock = document.createElement("span"); lock.textContent = "Scheduled by ALS";
      const input = document.createElement("input"); input.type = "hidden"; input.value = presetValue;
      input.dataset.fieldInput = field.FieldOID; input.dataset.codedName = field.VariableOID || field.FieldOID; input.dataset.fixedPreset = "true";
      control.append(value, lock, input);
    } else {
      control = document.createElement("div"); control.className = "field-control";
      control.append(createControl(field, { isLog: true, recordId }));
    }
    label.className = "log-label";
    const inspect = inspectIconButton(field); inspect.classList.add("log-inspect");
    cell.append(label, tags, control, inspect); return cell;
  }

  function addLogRecord(logFields, records, dynamicTargets, options = {}) {
    const recordId = `log-${++state.logRecordSerial}`;
    const row = document.createElement("div"); row.className = `log-record${options.fixed ? " fixed-log-record" : ""}`; row.dataset.recordId = recordId;
    row.style.setProperty("--log-columns", logFields.length);
    const identity = document.createElement("div"); identity.className = "record-identity";
    const number = records.children.length + 1; identity.innerHTML = `<b>${String(number).padStart(2, "0")}</b><span>Record</span>`;
    row.append(identity);
    if (!options.fixed) {
      const expand = document.createElement("button"); expand.type = "button"; expand.className = "expand-record";
      expand.dataset.expandRecord = recordId; expand.textContent = "Expand";
      expand.setAttribute("aria-expanded", "false"); expand.title = "Expand record vertically";
      identity.append(expand);
    }
    for (const field of logFields) {
      const isPresetField = options.fixed && String(field.DefaultValue ?? "").includes("|");
      const values = isPresetField ? delimitedDefaults(field) : [];
      row.append(createLogCell(field, recordId, dynamicTargets, isPresetField ? (values[options.presetIndex] ?? "") : undefined));
    }
    if (!options.fixed) {
      const actions = document.createElement("div"); actions.className = "record-actions";
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "remove-record"; remove.dataset.removeRecord = recordId; remove.textContent = "Remove"; remove.disabled = number === 1;
      actions.append(remove); row.append(actions);
    }
    records.append(row); evaluateDynamicRules(row, false);
  }

  function renderLogSection(logFields, dynamicTargets, profile) {
    const fixed = profile.kind === "mixed-fixed";
    const section = document.createElement("section"); section.className = `log-section${fixed ? " fixed-log-section" : ""}`;
    const heading = document.createElement("header"); heading.className = "log-heading";
    const title = document.createElement("div");
    title.innerHTML = fixed
      ? `<span>ALS-defined schedule</span><h3>Fixed log rows</h3><p>${profile.rowCount} time point${profile.rowCount === 1 ? "" : "s"} generated from pipe-delimited DefaultValue metadata.</p>`
      : `<span>Repeating data</span><h3>Log records</h3><p>${logFields.length} fields repeat independently in each record. New records start blank. Expand a record to read its fields vertically.</p>`;
    heading.append(title);
    if (!fixed) {
      const add = document.createElement("button"); add.type = "button"; add.className = "button button-primary"; add.dataset.addRecord = "true"; add.textContent = "+ Add record"; heading.append(add);
    }
    const viewport = document.createElement("div"); viewport.className = "log-viewport";
    const records = document.createElement("div"); records.className = "log-records"; records.dataset.logFields = logFields.map((field) => field.FieldOID).join("|"); viewport.append(records);
    records.dataset.fixedLog = String(fixed); section.append(heading, viewport);
    if (fixed) for (let index = 0; index < profile.rowCount; index += 1) addLogRecord(logFields, records, dynamicTargets, { fixed: true, presetIndex: index });
    else addLogRecord(logFields, records, dynamicTargets);
    return section;
  }

  function visibleFieldsForCurrentForm() {
    const query = state.fieldQuery.toLowerCase();
    return (fieldsByForm.get(String(state.selectedForm)) || []).filter((field) => {
      if (!state.showInactiveFields && isInactive(field, "DraftFieldActive")) return false;
      if (!state.showTechnical && isTechnical(field)) return false;
      return !query || `${field.FieldOID} ${field.VariableOID || ""} ${fieldLabel(field)}`.toLowerCase().includes(query);
    });
  }

  function renderForm() {
    const form = formsByOid.get(String(state.selectedForm)); if (!form) return;
    refs.formTitle.textContent = cleanText(form.DraftFormName) || form.OID; refs.formOid.textContent = form.OID; refs.formMeta.replaceChildren();
    const inactive = isInactive(form, "DraftFormActive"); refs.formMeta.append(chip(inactive ? "Inactive form" : "Active form", inactive ? "inactive" : "active"));
    if (truthy(form.IsSignatureRequired)) refs.formMeta.append(chip("Signature required"));
    if (form.LogDirection) refs.formMeta.append(chip(`Layout: ${form.LogDirection}`));
    const allFields = fieldsByForm.get(String(form.OID)) || []; const profile = formProfile(allFields);
    refs.formMeta.append(chip(profile.label, `profile-${profile.kind}`));
    const fields = visibleFieldsForCurrentForm(); refs.visibleFieldCount.textContent = `${fields.length} field${fields.length === 1 ? "" : "s"}`;
    refs.formCanvas.classList.toggle("show-metadata", state.showMetadata); refs.formCanvas.replaceChildren();
    const intro = document.createElement("header"); intro.className = "canvas-intro"; intro.innerHTML = `<div><span>Case report form</span><h2></h2></div><div class="record-badge">${profile.canvasLabel}</div>`;
    $("h2", intro).textContent = cleanText(form.DraftFormName) || form.OID; refs.formCanvas.append(intro);
    if (!fields.length) { const empty = document.createElement("div"); empty.className = "empty-state"; empty.innerHTML = '<div class="empty-mark">Ø</div><h2>No fields to display</h2><p>Change the filters or select another form.</p>'; refs.formCanvas.append(empty); updateRuleBanner(); return; }
    const dynamicTargets = targetFieldsForForm(form.OID);
    if (profile.kind.startsWith("mixed")) {
      const fixed = fields.filter((field) => !truthy(field.IsLog)); const log = fields.filter((field) => truthy(field.IsLog));
      if (fixed.length) { const fixedSection = document.createElement("div"); fixedSection.className = "fixed-fields"; fixed.forEach((field, index) => fixedSection.append(createFieldRow(field, index, dynamicTargets))); refs.formCanvas.append(fixedSection); }
      if (log.length) refs.formCanvas.append(renderLogSection(log, dynamicTargets, profile));
    } else if (profile.kind === "repeating") {
      refs.formCanvas.append(renderLogSection(fields, dynamicTargets, profile));
    } else {
      const fixedSection = document.createElement("div"); fixedSection.className = "fixed-fields"; fields.forEach((field, index) => fixedSection.append(createFieldRow(field, index, dynamicTargets))); refs.formCanvas.append(fixedSection);
    }
    const dynamicDepths = dynamicDepthsForForm(form.OID);
    for (const [oid, depth] of dynamicDepths) {
      const tier = depth <= 1 ? 1 : ((depth - 2) % 3) + 2;
      for (const node of $$(`[data-field-oid="${CSS.escape(oid)}"]`, refs.formCanvas)) {
        node.dataset.dynamicDepth = String(depth);
        node.classList.add(`dynamic-depth-tier-${tier}`);
        const dynamicTag = $(".tag-dynamic", node);
        if (dynamicTag) { dynamicTag.textContent = `Dynamic L${depth + 1}`; dynamicTag.title = `Dynamic hierarchy level ${depth + 1}`; }
      }
    }
    for (const oid of triggerFieldsForForm(form.OID)) {
      for (const node of $$(`[data-field-oid="${CSS.escape(oid)}"]`, refs.formCanvas)) {
        node.classList.add("is-dynamic-trigger");
        node.dataset.dynamicTrigger = "true";
        const tags = $(".field-subline", node);
        if (tags && !$(".tag-trigger", tags)) {
          const level = (dynamicDepths.get(oid) ?? 0) + 1;
          const triggerTag = fieldTag(`Trigger L${level}`, "tag-trigger");
          triggerTag.title = `Trigger at dynamic hierarchy level ${level}`;
          tags.append(triggerTag);
        }
      }
    }
    $$(".fixed-fields", refs.formCanvas).forEach((scope) => evaluateDynamicRules(scope, false)); updateRuleBanner();
  }

  function fieldInputs(fieldOid, scope) {
    let inputs = $$(`[data-field-input="${CSS.escape(String(fieldOid))}"]`, scope);
    if (!inputs.length && scope.classList?.contains("log-record")) inputs = $$(`[data-field-input="${CSS.escape(String(fieldOid))}"]`, refs.formCanvas).filter((input) => !input.closest(".log-record"));
    return inputs;
  }

  function fieldValue(fieldOid, scope) {
    const inputs = fieldInputs(fieldOid, scope);
    if (!inputs.length) return "";
    if (inputs[0].type === "radio") return inputs.find((input) => input.checked)?.value || "";
    if (inputs[0].type === "checkbox") return inputs[0].checked;
    return inputs[0].value;
  }

  function conditionMatches(condition, scope) {
    const inputs = fieldInputs(condition.field, scope);
    if (!inputs.length || !inputs.some((input) => !input.disabled && !input.closest(".is-dynamic-hidden"))) return false;
    const actual = fieldValue(condition.field, scope); const expected = condition.value ?? condition.values;
    switch (String(condition.operator)) {
      case "equals": return String(actual) === String(expected);
      case "not_equals": return String(actual) !== String(expected);
      case "in": return (Array.isArray(expected) ? expected : [expected]).map(String).includes(String(actual));
      case "not_in": return !(Array.isArray(expected) ? expected : [expected]).map(String).includes(String(actual));
      case "contains": return String(actual).includes(String(expected));
      case "is_blank": return actual === "" || actual === null || actual === undefined;
      case "is_not_blank": return !(actual === "" || actual === null || actual === undefined);
      default: return false;
    }
  }

  function fieldNodes(fieldOid, scope) {
    const selector = `[data-field-oid="${CSS.escape(String(fieldOid))}"]`;
    const local = $$(selector, scope);
    if (local.length || scope.classList?.contains("log-record")) return local;
    return $$(selector, refs.formCanvas);
  }

  function clearInputs(node) {
    for (const input of $$(`[data-field-input]`, node)) {
      if (["radio", "checkbox"].includes(input.type)) input.checked = false;
      else input.value = "";
    }
  }

  function applyActions(actions, scope, clearAllowed) {
    for (const fieldOid of actions.show || []) for (const node of fieldNodes(fieldOid, scope)) { node.classList.remove("is-dynamic-hidden"); node.classList.add("is-dynamic-revealed"); node.setAttribute("aria-hidden", "false"); $$(`[data-field-input]`, node).forEach((input) => { input.disabled = false; input.required = node.dataset.baseRequired === "true"; }); }
    for (const fieldOid of actions.hide || []) for (const node of fieldNodes(fieldOid, scope)) { node.classList.add("is-dynamic-hidden"); node.classList.remove("is-dynamic-revealed"); node.setAttribute("aria-hidden", "true"); $$(`[data-field-input]`, node).forEach((input) => { input.disabled = true; input.required = false; }); }
    for (const fieldOid of actions.disable || []) for (const node of fieldNodes(fieldOid, scope)) $$(`[data-field-input]`, node).forEach((input) => { input.disabled = true; input.required = false; });
    if (clearAllowed) for (const fieldOid of actions.clear || []) for (const node of fieldNodes(fieldOid, scope)) clearInputs(node);
  }

  function evaluateDynamicRules(scope, clearAllowed) {
    const rules = formRules(); if (!rules.length) return;
    const allTargets = targetFieldsForForm(state.selectedForm);
    for (const oid of allTargets) for (const node of fieldNodes(oid, scope)) {
      node.classList.remove("is-dynamic-hidden", "is-dynamic-revealed"); node.setAttribute("aria-hidden", "false");
      $$(`[data-field-input]`, node).forEach((input) => { input.disabled = false; input.required = node.dataset.baseRequired === "true"; });
    }
    // Multiple passes let parent/child chains settle regardless of their order in YAML.
    for (let pass = 0; pass <= rules.length; pass += 1) {
      for (const rule of rules) applyActions(conditionMatches(rule.when, scope) ? rule.then : rule.otherwise, scope, clearAllowed);
    }
  }

  function updateRuleBanner() {
    const rules = formRules(); refs.ruleCount.textContent = state.parsedRules.rules.length; refs.ruleBanner.hidden = !rules.length;
    if (rules.length) { refs.ruleBannerTitle.textContent = `${rules.length} dynamic rule${rules.length === 1 ? "" : "s"} active`; refs.ruleBannerText.textContent = rules.map((rule) => rule.description || rule.id).join(" · "); }
  }

  function selectForm(oid, updateHash = true) {
    if (!formsByOid.has(String(oid))) return; state.selectedForm = String(oid); state.fieldQuery = ""; refs.fieldSearch.value = "";
    if (updateHash) history.replaceState(null, "", `#${encodeURIComponent(state.selectedForm)}`);
    renderSidebar(); renderForm(); refs.formTitle.focus?.({ preventScroll: true });
  }

  function openInspector(fieldOid) {
    const field = (fieldsByForm.get(String(state.selectedForm)) || []).find((item) => String(item.FieldOID) === String(fieldOid)); if (!field) return;
    refs.inspectorOid.textContent = field.FieldOID; refs.inspectorBody.replaceChildren();
    const details = [["Label", fieldLabel(field)], ["Form OID", field.FormOID], ["Field OID", field.FieldOID], ["Variable OID", field.VariableOID || "—"], ["Ordinal", field.Ordinal], ["Control type", field.ControlType], ["Data format", field.DataFormat || "—"], ["Dictionary", field.DataDictionaryName || "—"], ["Fixed unit", field.FixedUnit || "—"], ["Required", field.IsRequired], ["Initially visible", field.IsVisible], ["IsLog", field.IsLog], ["Default value", field.DefaultValue || "—"]];
    const section = document.createElement("section"); section.className = "inspector-section"; section.innerHTML = "<h3>ALS definition</h3>";
    const dl = document.createElement("dl"); dl.className = "definition-list"; for (const [key, value] of details) { const dt = document.createElement("dt"); dt.textContent = key; const dd = document.createElement("dd"); dd.textContent = String(value ?? "—"); dl.append(dt, dd); } section.append(dl); refs.inspectorBody.append(section);
    const entries = dictionaryFor(field); if (entries.length) { const dictSection = document.createElement("section"); dictSection.className = "inspector-section"; dictSection.innerHTML = `<h3>Dictionary values (${entries.length})</h3>`; const list = document.createElement("div"); list.className = "dictionary-list"; for (const entry of entries) { const item = document.createElement("div"); item.className = "dictionary-entry"; const user = document.createElement("span"); user.textContent = entry.UserDataString; const code = document.createElement("code"); code.textContent = entry.CodedData; item.append(user, code); list.append(item); } dictSection.append(list); refs.inspectorBody.append(dictSection); }
    refs.inspector.classList.add("open"); refs.inspector.setAttribute("aria-hidden", "false"); refs.scrim.hidden = false;
  }

  function closeInspector() { refs.inspector.classList.remove("open"); refs.inspector.setAttribute("aria-hidden", "true"); refs.scrim.hidden = true; }
  function setPrintPreview(active) {
    document.body.classList.toggle("print-preview", active);
    refs.printPreviewBar.hidden = !active;
    refs.printButton.setAttribute("aria-pressed", String(active));
    if (active) { closeInspector(); scrollTo({ top: 0, behavior: "smooth" }); }
  }
  function toast(message) { refs.toast.textContent = message; refs.toast.classList.add("show"); clearTimeout(toast.timer); toast.timer = setTimeout(() => refs.toast.classList.remove("show"), 2200); }
  function openRules() { refs.rulesEditor.value = state.rulesYaml; refs.ruleStatus.classList.remove("error"); refs.ruleStatus.textContent = `${state.parsedRules.rules.length} valid rule${state.parsedRules.rules.length === 1 ? "" : "s"} loaded.`; refs.rulesDialog.showModal(); }
  function applyRules() { try { const parsed = parseRulesYaml(refs.rulesEditor.value); state.parsedRules = parsed; state.rulesYaml = refs.rulesEditor.value; refs.ruleStatus.classList.remove("error"); refs.ruleStatus.textContent = `${parsed.rules.length} rules loaded successfully.`; renderForm(); toast("Dynamic rules applied"); refs.rulesDialog.close(); } catch (error) { refs.ruleStatus.textContent = `YAML error: ${error.message}`; refs.ruleStatus.classList.add("error"); } }

  refs.formList.addEventListener("click", (event) => { const target = event.target.closest("[data-form-oid]"); if (target) selectForm(target.dataset.formOid); });
  refs.globalSearch.addEventListener("input", () => { state.formQuery = refs.globalSearch.value.trim(); renderSidebar(); });
  refs.fieldSearch.addEventListener("input", () => { state.fieldQuery = refs.fieldSearch.value.trim(); renderForm(); });
  refs.inactiveFormsButton.addEventListener("click", () => { state.showInactiveForms = !state.showInactiveForms; refs.inactiveFormsButton.setAttribute("aria-pressed", state.showInactiveForms); renderSidebar(); });
  for (const [button, key] of [[refs.inactiveFieldsButton, "showInactiveFields"], [refs.technicalFieldsButton, "showTechnical"], [refs.metadataButton, "showMetadata"]]) button.addEventListener("click", () => { state[key] = !state[key]; button.setAttribute("aria-pressed", state[key]); renderForm(); });
  refs.resetButton.addEventListener("click", () => { refs.formCanvas.querySelectorAll("input,textarea,select").forEach((input) => { if (input.dataset.fixedPreset === "true") return; if (["radio", "checkbox"].includes(input.type)) input.checked = false; else input.value = ""; }); if (!$(".fixed-log-section", refs.formCanvas)) $$(".log-record", refs.formCanvas).slice(1).forEach((row) => row.remove()); $$(".fixed-fields,.log-record", refs.formCanvas).forEach((scope) => evaluateDynamicRules(scope, false)); toast("Form reset"); });
  refs.printButton.addEventListener("click", () => setPrintPreview(true));
  refs.closePrintPreview.addEventListener("click", () => setPrintPreview(false));
  refs.printNowButton.addEventListener("click", () => window.print());
  refs.formCanvas.addEventListener("click", (event) => {
    const expand = event.target.closest("[data-expand-record]");
    if (expand) {
      const row = expand.closest(".log-record");
      if (!row || row.classList.contains("fixed-log-record")) return;
      const expanded = row.classList.toggle("is-expanded");
      expand.setAttribute("aria-expanded", String(expanded)); expand.textContent = expanded ? "Collapse" : "Expand";
      expand.title = expanded ? "Return to horizontal record" : "Expand record vertically";
      row.scrollLeft = 0;
      return;
    }
    const inspect = event.target.closest("[data-inspect-field]"); if (inspect) return openInspector(inspect.dataset.inspectField);
    const add = event.target.closest("[data-add-record]"); if (add) { const records = $(".log-records", refs.formCanvas); if (!records || records.dataset.fixedLog === "true") return; const fields = records.dataset.logFields.split("|").map((oid) => (fieldsByForm.get(String(state.selectedForm)) || []).find((field) => String(field.FieldOID) === oid)).filter(Boolean); addLogRecord(fields, records, targetFieldsForForm(state.selectedForm)); toast("Blank log record added"); return; }
    const remove = event.target.closest("[data-remove-record]"); if (remove && !remove.disabled) { remove.closest(".log-record").remove(); $$(".log-record", refs.formCanvas).forEach((row, index) => $(".record-identity b", row).textContent = String(index + 1).padStart(2, "0")); toast("Log record removed"); }
  });
  refs.formCanvas.addEventListener("change", (event) => { if (!event.target.matches("[data-field-input]")) return; const scope = event.target.closest(".log-record") || event.target.closest(".fixed-fields"); if (scope) evaluateDynamicRules(scope, true); });
  refs.rulesButton.addEventListener("click", openRules); refs.openRulesInline.addEventListener("click", openRules); refs.applyRulesButton.addEventListener("click", applyRules);
  refs.themeSelect.value = savedTheme;
  refs.themeSelect.addEventListener("change", () => {
    const theme = supportedThemes.has(refs.themeSelect.value) ? refs.themeSelect.value : "soft";
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(themeKey, theme); } catch (_) { /* keep the in-session choice */ }
    toast(theme === "soft" ? "Soft calm theme applied" : "Performance Coral theme applied");
  });
  refs.rulesFile.addEventListener("change", async () => {
    const file = refs.rulesFile.files[0]; if (!file) return;
    try {
      const current = parseRulesYaml(refs.rulesEditor.value);
      const incoming = parseRulesYaml(await file.text());
      const merged = mergeRuleDocuments(current, incoming);
      refs.rulesEditor.value = serializeRulesYaml(merged.document);
      refs.ruleStatus.classList.remove("error");
      refs.ruleStatus.textContent = `${file.name} merged: ${merged.added} added, ${merged.updated} updated, ${merged.unchanged} unchanged; ${merged.document.rules.length} total. Select Apply rules.`;
    } catch (error) {
      refs.ruleStatus.textContent = `YAML error: ${error.message}`;
      refs.ruleStatus.classList.add("error");
    } finally { refs.rulesFile.value = ""; }
  });
  refs.closeInspector.addEventListener("click", closeInspector); refs.scrim.addEventListener("click", closeInspector);
  window.addEventListener("hashchange", () => selectForm(decodeURIComponent(location.hash.slice(1)), false));
  document.addEventListener("keydown", (event) => { if (event.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { event.preventDefault(); refs.globalSearch.focus(); } if (event.key === "Escape") { closeInspector(); if (document.body.classList.contains("print-preview")) setPrintPreview(false); } });

  function updateStudySummary() {
    refs.studyName.textContent = "Study CRF Library"; refs.sourceFile.textContent = study.sourceFile; refs.formCount.textContent = study.summary.formCount; refs.fieldCount.textContent = study.summary.fieldCount; refs.dictionaryCount.textContent = `${study.summary.dictionaryCount} dictionaries`;
  }
  function loadStudy(nextStudy) {
    indexStudy(nextStudy);
    state.selectedForm = formsByOid.has("AE_MIX") ? "AE_MIX" : String(study.forms.find((form) => !isInactive(form, "DraftFormActive"))?.OID || study.forms[0]?.OID || "");
    state.formQuery = ""; state.fieldQuery = ""; state.showInactiveForms = false; state.showInactiveFields = false; state.showTechnical = false; state.showMetadata = false; state.logRecordSerial = 0;
    refs.globalSearch.value = ""; refs.fieldSearch.value = "";
    for (const button of [refs.inactiveFormsButton, refs.inactiveFieldsButton, refs.technicalFieldsButton, refs.metadataButton]) button.setAttribute("aria-pressed", "false");
    updateStudySummary(); selectForm(state.selectedForm); toast(`${study.sourceFile} loaded`);
  }
  window.CRF_APP = Object.freeze({ loadStudy });
  updateStudySummary();
  try { state.parsedRules = parseRulesYaml(state.rulesYaml); } catch (error) { console.error(error); }
  selectForm(state.selectedForm, false);
})();
