import { createHash } from "node:crypto";

export const MENU_IMPORT_HEADERS = [
  "row_action",
  "branch_code",
  "menu_code",
  "category_code",
  "category_name",
  "item_code",
  "item_name",
  "description",
  "variant_code",
  "variant_name",
  "price_ghs",
  "tax_class_code",
  "production_station_codes",
  "availability_schedule_code",
  "track_inventory",
  "recipe_code",
  "allergen_codes",
  "age_restricted",
  "display_order",
  "active",
  "notes",
] as const;

export type MenuImportIssue = Readonly<{
  row: number;
  field: string;
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
}>;

export type ParsedMenuImportRow = Readonly<{
  rowNumber: number;
  categoryCode: string;
  categoryName: string;
  itemCode: string;
  itemName: string;
  description: string | null;
  variantCode: string | null;
  variantName: string | null;
  priceMinor: number | null;
  taxClassCode: string | null;
  stationCode: string | null;
  displayOrder: number;
  active: boolean;
  notes: string | null;
}>;

export type MenuImportParseResult = Readonly<{
  sourceHash: string;
  rows: ParsedMenuImportRow[];
  issues: MenuImportIssue[];
}>;

type ParseOptions = Readonly<{
  branchCode: string;
  menuCode: string;
}>;

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,79}$/;
const FORMULA_PREFIX = /^[=+\-@]/;
const MAX_ROWS = 2_000;
const MAX_CELL_LENGTH = 2_000;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function menuImportValidationHash(
  sourceHash: string,
  branchId: string,
  branchCode: string,
  menuCode: string,
): string {
  return sha256(
    JSON.stringify({
      validatorVersion: 1,
      schemaVersion: "menu-v1",
      sourceHash,
      branchId,
      branchCode,
      menuCode,
    }),
  );
}

function parseCsvRecords(csvText: string): string[][] {
  const source = csvText.charCodeAt(0) === 0xfeff ? csvText.slice(1) : csvText;
  if (source.includes("\0")) throw new Error("CSV contains a NUL byte.");

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;

  const pushField = () => {
    if (field.length > MAX_CELL_LENGTH) {
      throw new Error(`CSV cell exceeds ${MAX_CELL_LENGTH} characters.`);
    }
    record.push(field);
    field = "";
    afterQuote = false;
  };
  const pushRecord = () => {
    pushField();
    records.push(record);
    record = [];
    if (records.length > MAX_ROWS + 1) {
      throw new Error(`CSV exceeds ${MAX_ROWS} data rows.`);
    }
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        field += character;
      }
      continue;
    }
    if (
      afterQuote &&
      character !== "," &&
      character !== "\r" &&
      character !== "\n"
    ) {
      throw new Error("CSV has characters after a closing quote.");
    }
    if (character === '"') {
      if (field.length > 0)
        throw new Error("CSV has a quote inside an unquoted field.");
      inQuotes = true;
    } else if (character === ",") {
      pushField();
    } else if (character === "\r" || character === "\n") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      pushRecord();
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error("CSV has an unterminated quoted field.");
  if (field.length || record.length) pushRecord();
  return records.filter((row) => row.some((cell) => cell.trim().length > 0));
}

function normalizedCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return CODE_PATTERN.test(normalized) ? normalized : null;
}

function parseBoolean(value: string): boolean | null {
  const normalized = value.trim().toUpperCase();
  if (normalized === "TRUE") return true;
  if (normalized === "FALSE") return false;
  return null;
}

export function parseGhsMinor(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d{1,8}(?:\.\d{2})?$/.test(normalized)) return null;
  const [whole = "0", fraction = "00"] = normalized.split(".");
  const amount =
    Number.parseInt(whole, 10) * 100 +
    Number.parseInt(fraction.padEnd(2, "0"), 10);
  return Number.isSafeInteger(amount) && amount <= 2_000_000_000
    ? amount
    : null;
}

export function parseMenuImportCsv(
  csvText: string,
  options: ParseOptions,
): MenuImportParseResult {
  const sourceHash = sha256(csvText);
  const issues: MenuImportIssue[] = [];
  let records: string[][];
  try {
    records = parseCsvRecords(csvText);
  } catch (error) {
    return {
      sourceHash,
      rows: [],
      issues: [
        {
          row: 1,
          field: "csv",
          severity: "ERROR",
          code: "MALFORMED_CSV",
          message:
            error instanceof Error ? error.message : "CSV could not be parsed.",
        },
      ],
    };
  }

  const header = records.shift();
  if (
    !header ||
    header.length !== MENU_IMPORT_HEADERS.length ||
    header.some((value, index) => value.trim() !== MENU_IMPORT_HEADERS[index])
  ) {
    return {
      sourceHash,
      rows: [],
      issues: [
        {
          row: 1,
          field: "header",
          severity: "ERROR",
          code: "HEADER_MISMATCH",
          message:
            "CSV headers must exactly match templates/menu_import_template.csv version menu-v1.",
        },
      ],
    };
  }

  const rows: ParsedMenuImportRow[] = [];
  const categoryNames = new Map<string, string>();
  const itemSignatures = new Map<string, string>();
  const targets = new Set<string>();
  const addIssue = (
    row: number,
    field: string,
    code: string,
    message: string,
    severity: "ERROR" | "WARNING" = "ERROR",
  ) => issues.push({ row, field, severity, code, message });

  records.forEach((record, dataIndex) => {
    const rowNumber = dataIndex + 2;
    if (record.length !== MENU_IMPORT_HEADERS.length) {
      addIssue(
        rowNumber,
        "row",
        "COLUMN_COUNT",
        `Expected ${MENU_IMPORT_HEADERS.length} columns but found ${record.length}.`,
      );
      return;
    }
    const values = Object.fromEntries(
      MENU_IMPORT_HEADERS.map((name, index) => [
        name,
        record[index]?.trim() ?? "",
      ]),
    ) as Record<(typeof MENU_IMPORT_HEADERS)[number], string>;

    for (const [fieldName, value] of Object.entries(values)) {
      if (value && FORMULA_PREFIX.test(value)) {
        addIssue(
          rowNumber,
          fieldName,
          "FORMULA_INJECTION_RISK",
          "Values beginning with =, +, -, or @ are not accepted.",
        );
      }
    }
    if (values.row_action === "EXAMPLE_DO_NOT_IMPORT") {
      addIssue(
        rowNumber,
        "row_action",
        "EXAMPLE_ROW",
        "Replace the fictional example row before importing.",
      );
    } else if (values.row_action !== "UPSERT") {
      addIssue(
        rowNumber,
        "row_action",
        "UNSUPPORTED_ACTION",
        "row_action must be UPSERT for menu-v1.",
      );
    }
    if (normalizedCode(values.branch_code) !== options.branchCode) {
      addIssue(
        rowNumber,
        "branch_code",
        "BRANCH_CODE_MISMATCH",
        `Expected branch_code ${options.branchCode}.`,
      );
    }
    if (normalizedCode(values.menu_code) !== options.menuCode) {
      addIssue(
        rowNumber,
        "menu_code",
        "MENU_CODE_MISMATCH",
        `Expected menu_code ${options.menuCode}.`,
      );
    }

    const categoryCode = normalizedCode(values.category_code);
    const itemCode = normalizedCode(values.item_code);
    const variantCode = values.variant_code
      ? normalizedCode(values.variant_code)
      : null;
    const taxClassCode = values.tax_class_code
      ? normalizedCode(values.tax_class_code)
      : null;
    const stationCodes = values.production_station_codes
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);
    const stationCode =
      stationCodes.length === 1 ? normalizedCode(stationCodes[0] ?? "") : null;
    if (!categoryCode)
      addIssue(
        rowNumber,
        "category_code",
        "INVALID_CODE",
        "category_code is required and must use letters, numbers, dot, underscore, or hyphen.",
      );
    if (!itemCode)
      addIssue(
        rowNumber,
        "item_code",
        "INVALID_CODE",
        "item_code is required and must use letters, numbers, dot, underscore, or hyphen.",
      );
    if (values.variant_code && !variantCode)
      addIssue(
        rowNumber,
        "variant_code",
        "INVALID_CODE",
        "variant_code has an invalid format.",
      );
    if (Boolean(values.variant_code) !== Boolean(values.variant_name))
      addIssue(
        rowNumber,
        "variant_code",
        "VARIANT_PAIR_REQUIRED",
        "variant_code and variant_name must either both be present or both be blank.",
      );
    if (values.tax_class_code && !taxClassCode)
      addIssue(
        rowNumber,
        "tax_class_code",
        "INVALID_CODE",
        "tax_class_code has an invalid format.",
      );
    if (stationCodes.length > 1)
      addIssue(
        rowNumber,
        "production_station_codes",
        "MULTIPLE_STATIONS_UNSUPPORTED",
        "menu-v1 supports exactly one default production station per item.",
      );
    if (stationCodes.length === 1 && !stationCode)
      addIssue(
        rowNumber,
        "production_station_codes",
        "INVALID_CODE",
        "The production station code has an invalid format.",
      );

    if (!values.category_name || values.category_name.length > 100)
      addIssue(
        rowNumber,
        "category_name",
        "INVALID_NAME",
        "category_name is required and limited to 100 characters.",
      );
    if (!values.item_name || values.item_name.length > 140)
      addIssue(
        rowNumber,
        "item_name",
        "INVALID_NAME",
        "item_name is required and limited to 140 characters.",
      );
    if (values.description.length > 1_000)
      addIssue(
        rowNumber,
        "description",
        "VALUE_TOO_LONG",
        "description is limited to 1000 characters.",
      );
    if (values.variant_name.length > 100)
      addIssue(
        rowNumber,
        "variant_name",
        "VALUE_TOO_LONG",
        "variant_name is limited to 100 characters.",
      );

    const priceMinor = values.price_ghs
      ? parseGhsMinor(values.price_ghs)
      : null;
    if (values.price_ghs && (priceMinor === null || priceMinor <= 0))
      addIssue(
        rowNumber,
        "price_ghs",
        "INVALID_PRICE",
        "price_ghs must be a positive GHS amount with at most two decimal places.",
      );
    const displayOrder = Number.parseInt(values.display_order, 10);
    if (!/^\d+$/.test(values.display_order) || displayOrder > 100_000)
      addIssue(
        rowNumber,
        "display_order",
        "INVALID_DISPLAY_ORDER",
        "display_order must be an integer from 0 to 100000.",
      );
    const active = parseBoolean(values.active);
    if (active === null)
      addIssue(
        rowNumber,
        "active",
        "INVALID_BOOLEAN",
        "active must be TRUE or FALSE.",
      );
    const trackInventory = parseBoolean(values.track_inventory);
    if (trackInventory === null)
      addIssue(
        rowNumber,
        "track_inventory",
        "INVALID_BOOLEAN",
        "track_inventory must be TRUE or FALSE.",
      );
    else if (trackInventory)
      addIssue(
        rowNumber,
        "track_inventory",
        "INVENTORY_IMPORT_NOT_AVAILABLE",
        "Inventory tracking and recipes are not available in Milestone 1.",
      );
    const ageRestricted = parseBoolean(values.age_restricted);
    if (ageRestricted === null)
      addIssue(
        rowNumber,
        "age_restricted",
        "INVALID_BOOLEAN",
        "age_restricted must be TRUE or FALSE.",
      );
    else if (ageRestricted)
      addIssue(
        rowNumber,
        "age_restricted",
        "AGE_POLICY_NOT_CONFIGURED",
        "Age-restricted sales cannot be enabled until the owner approves the policy.",
      );
    for (const field of [
      "availability_schedule_code",
      "recipe_code",
      "allergen_codes",
    ] as const) {
      if (values[field])
        addIssue(
          rowNumber,
          field,
          "FEATURE_NOT_AVAILABLE",
          `${field} is not yet supported and must be blank.`,
        );
    }
    if (values.notes)
      addIssue(
        rowNumber,
        "notes",
        "NOTES_NOT_APPLIED",
        "notes are not written to catalog records.",
        "WARNING",
      );

    if (active === true) {
      if (!stationCode)
        addIssue(
          rowNumber,
          "production_station_codes",
          "ACTIVE_STATION_REQUIRED",
          "An active catalog entry requires one production station code.",
        );
      if (!taxClassCode)
        addIssue(
          rowNumber,
          "tax_class_code",
          "ACTIVE_TAX_CLASS_REQUIRED",
          "An active catalog entry requires an approved tax class code.",
        );
      if (!priceMinor)
        addIssue(
          rowNumber,
          "price_ghs",
          "ACTIVE_PRICE_REQUIRED",
          "An active catalog entry requires a positive price.",
        );
    }

    if (
      !categoryCode ||
      !itemCode ||
      !values.category_name ||
      !values.item_name ||
      active === null ||
      !Number.isInteger(displayOrder)
    )
      return;

    const priorCategoryName = categoryNames.get(categoryCode);
    if (priorCategoryName && priorCategoryName !== values.category_name)
      addIssue(
        rowNumber,
        "category_name",
        "CATEGORY_CONFLICT",
        `category_code ${categoryCode} has conflicting names in the file.`,
      );
    else categoryNames.set(categoryCode, values.category_name);

    const itemSignature = JSON.stringify({
      categoryCode,
      itemName: values.item_name,
      description: values.description,
      taxClassCode,
      stationCode,
      displayOrder,
    });
    const priorItemSignature = itemSignatures.get(itemCode);
    if (priorItemSignature && priorItemSignature !== itemSignature)
      addIssue(
        rowNumber,
        "item_code",
        "ITEM_CONFLICT",
        `item_code ${itemCode} has conflicting item-level values in the file.`,
      );
    else itemSignatures.set(itemCode, itemSignature);

    const target = `${itemCode}:${variantCode ?? "BASE"}`;
    if (targets.has(target))
      addIssue(
        rowNumber,
        values.variant_code ? "variant_code" : "item_code",
        "DUPLICATE_TARGET",
        "The same item/variant target appears more than once.",
      );
    targets.add(target);
    rows.push({
      rowNumber,
      categoryCode,
      categoryName: values.category_name,
      itemCode,
      itemName: values.item_name,
      description: values.description || null,
      variantCode,
      variantName: values.variant_name || null,
      priceMinor,
      taxClassCode,
      stationCode,
      displayOrder,
      active,
      notes: values.notes || null,
    });
  });

  return { sourceHash, rows, issues };
}
