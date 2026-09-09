(() => {
  "use strict";

  const dialog = document.querySelector("#uploadDialog");
  const openButton = document.querySelector("#uploadButton");
  const fileInput = document.querySelector("#alsFile");
  const dropzone = document.querySelector("#alsDropzone");
  const status = document.querySelector("#uploadStatus");
  const requiredSheets = ["Forms", "Fields", "DataDictionaryEntries"];

  const formKeys = ["OID", "Ordinal", "DraftFormName", "DraftFormActive", "HelpText", "IsTemplate", "IsSignatureRequired", "IsEproForm", "ViewRestrictions", "EntryRestrictions", "LogDirection", "DDEOption", "ConfirmationStyle", "LinkFolderOID", "LinkFormOID"];
  const fieldKeys = ["FormOID", "FieldOID", "Ordinal", "DraftFieldNumber", "DraftFieldName", "DraftFieldActive", "VariableOID", "DataFormat", "DataDictionaryName", "UnitDictionaryName", "CodingDictionary", "ControlType", "AcceptableFileExtensions", "IndentLevel", "PreText", "FixedUnit", "HeaderText", "HelpText", "SourceDocument", "IsLog", "DefaultValue", "SASLabel", "SASFormat", "EproFormat", "IsRequired", "QueryFutureDate", "IsVisible", "IsTranslationRequired", "AnalyteName", "IsClinicalSignificance", "QueryNonConformance", "LowerRange", "UpperRange", "NCLowerRange", "NCUpperRange", "DoesNotBreakSignature"];
  const entryKeys = ["DataDictionaryName", "CodedData", "Ordinal", "UserDataString", "Specify"];

  function setStatus(message, type = "") {
    status.textContent = message;
    status.className = `upload-status${type ? ` ${type}` : ""}`;
  }

  function rowsFromSheet(workbook, sheetName) {
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, raw: true });
    if (!matrix.length) return [];
    const headers = matrix[0].map((value) => String(value ?? "").trim());
    return matrix.slice(1).map((row) => Object.fromEntries(headers.map((header, index) => [header || `_column${index + 1}`, row[index] ?? null])));
  }

  function pick(row, keys) {
    return Object.fromEntries(keys.map((key) => [key, row[key] ?? null]));
  }

  function truthy(value) {
    return String(value ?? "").toUpperCase() === "TRUE";
  }

  function normalizeWorkbook(workbook, file) {
    const missingSheets = requiredSheets.filter((name) => !workbook.SheetNames.includes(name));
    if (missingSheets.length) throw new Error(`Missing required sheet${missingSheets.length === 1 ? "" : "s"}: ${missingSheets.join(", ")}.`);

    const formRows = rowsFromSheet(workbook, "Forms");
    const fieldRows = rowsFromSheet(workbook, "Fields");
    const entryRows = rowsFromSheet(workbook, "DataDictionaryEntries");
    const requiredColumns = [
      ["Forms", formRows[0], ["OID", "Ordinal", "DraftFormName", "DraftFormActive"]],
      ["Fields", fieldRows[0], ["FormOID", "FieldOID", "Ordinal", "DraftFieldActive", "ControlType", "IsLog"]],
      ["DataDictionaryEntries", entryRows[0], ["DataDictionaryName", "CodedData", "Ordinal", "UserDataString"]],
    ];
    for (const [sheetName, sample, columns] of requiredColumns) {
      if (!sample) throw new Error(`${sheetName} does not contain data rows.`);
      const missing = columns.filter((column) => !(column in sample));
      if (missing.length) throw new Error(`${sheetName} is missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`);
    }

    const forms = formRows.filter((row) => row.OID).map((row) => pick(row, formKeys)).sort((a, b) => Number(a.Ordinal || 0) - Number(b.Ordinal || 0));
    const fields = fieldRows.filter((row) => row.FormOID && row.FieldOID).map((row) => pick(row, fieldKeys)).sort((a, b) => String(a.FormOID).localeCompare(String(b.FormOID)) || Number(a.Ordinal || 0) - Number(b.Ordinal || 0));
    const dictionaryEntries = entryRows.filter((row) => row.DataDictionaryName).map((row) => pick(row, entryKeys)).sort((a, b) => String(a.DataDictionaryName).localeCompare(String(b.DataDictionaryName)) || Number(a.Ordinal || 0) - Number(b.Ordinal || 0));
    if (!forms.length || !fields.length) throw new Error("The ALS workbook contains no usable forms or fields.");

    const formOids = new Set(forms.map((form) => String(form.OID)));
    const orphan = fields.find((field) => !formOids.has(String(field.FormOID)));
    if (orphan) throw new Error(`Field ${orphan.FieldOID} references missing form ${orphan.FormOID}.`);
    const controlTypes = Object.entries(fields.reduce((counts, field) => {
      const key = String(field.ControlType || "Unknown"); counts[key] = (counts[key] || 0) + 1; return counts;
    }, {})).sort((a, b) => b[1] - a[1]);

    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      sourceFile: file.name,
      summary: {
        formCount: forms.length,
        activeFormCount: forms.filter((form) => truthy(form.DraftFormActive)).length,
        fieldCount: fields.length,
        activeFieldCount: fields.filter((field) => truthy(field.DraftFieldActive)).length,
        dictionaryCount: new Set(dictionaryEntries.map((entry) => entry.DataDictionaryName)).size,
        dictionaryEntryCount: dictionaryEntries.length,
        controlTypes,
      },
      forms,
      fields,
      dictionaryEntries,
    };
  }

  async function loadFile(file) {
    if (!file) return;
    if (!/\.(xlsx|xls|xlsm|xlsb)$/i.test(file.name)) {
      setStatus("Choose an Excel ALS workbook (.xlsx, .xls, .xlsm, or .xlsb).", "error");
      return;
    }
    if (!window.XLSX) {
      setStatus("The workbook reader could not be loaded. Keep vendor/xlsx.full.min.js with the app.", "error");
      return;
    }
    try {
      setStatus(`Reading ${file.name}…`, "working");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false, dense: false });
      const study = normalizeWorkbook(workbook, file);
      window.CRF_APP.loadStudy(study);
      setStatus(`${file.name} loaded: ${study.summary.formCount} forms and ${study.summary.fieldCount} fields.`, "success");
      setTimeout(() => dialog.close(), 650);
    } catch (error) {
      console.error(error);
      setStatus(`Could not load this ALS: ${error.message}`, "error");
    } finally {
      fileInput.value = "";
    }
  }

  openButton.addEventListener("click", () => {
    setStatus("Ready for an Excel workbook.");
    dialog.showModal();
  });
  fileInput.addEventListener("change", () => loadFile(fileInput.files[0]));
  for (const eventName of ["dragenter", "dragover"]) dropzone.addEventListener(eventName, (event) => {
    event.preventDefault(); dropzone.classList.add("is-dragging");
  });
  for (const eventName of ["dragleave", "drop"]) dropzone.addEventListener(eventName, (event) => {
    event.preventDefault(); dropzone.classList.remove("is-dragging");
  });
  dropzone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]));
})();
