import type {
  MenuImportApplyRequest,
  MenuImportDryRunRequest,
} from "@base-cafe/contracts";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";

import type { AuthPrincipal } from "../auth/auth.types.js";
import { hasPermission } from "../auth/auth.types.js";
import { PrismaService } from "../database/prisma.service.js";
import { CatalogConfigurationService } from "./catalog-configuration.service.js";
import {
  menuImportValidationHash,
  parseMenuImportCsv,
  type MenuImportIssue,
  type ParsedMenuImportRow,
} from "./menu-import-parser.js";

type DatabaseClient = Prisma.TransactionClient | PrismaService;
type ExistingItem = Prisma.MenuItemGetPayload<{
  include: {
    prices: true;
    variants: { include: { prices: true } };
  };
}>;

type CatalogContext = Readonly<{
  categories: Awaited<ReturnType<DatabaseClient["category"]["findMany"]>>;
  stations: Awaited<ReturnType<DatabaseClient["station"]["findMany"]>>;
  taxClasses: Awaited<ReturnType<DatabaseClient["taxClass"]["findMany"]>>;
  items: ExistingItem[];
}>;

type DryRunResult = Readonly<{
  schemaVersion: "menu-v1";
  fileName: string;
  sourceHash: string;
  validationHash: string;
  valid: boolean;
  summary: {
    dataRows: number;
    categories: number;
    items: number;
    variants: number;
    prices: number;
    errors: number;
    warnings: number;
  };
  issues: MenuImportIssue[];
}>;

function toJson(value: unknown): Prisma.InputJsonObject {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
}

function activePrice<
  T extends { effectiveFrom: Date; effectiveTo: Date | null },
>(prices: T[], now: Date): T[] {
  return prices.filter(
    (price) =>
      price.effectiveFrom <= now &&
      (price.effectiveTo === null || price.effectiveTo > now),
  );
}

@Injectable()
export class MenuImportService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CatalogConfigurationService)
    private readonly mutations: CatalogConfigurationService,
  ) {}

  async dryRun(input: MenuImportDryRunRequest, principal: AuthPrincipal) {
    this.assertPermission(principal, input.branchId);
    await this.assertBranch(
      this.prisma,
      input.branchId,
      principal.organizationId,
    );
    return this.buildDryRun(this.prisma, input);
  }

  async apply(
    input: MenuImportApplyRequest,
    idempotencyKey: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, input.branchId);
    const parsed = parseMenuImportCsv(input.csvText, {
      branchCode: input.branchCode,
      menuCode: input.menuCode,
    });
    const expectedValidationHash = menuImportValidationHash(
      parsed.sourceHash,
      input.branchId,
      input.branchCode,
      input.menuCode,
    );
    if (input.validationHash !== expectedValidationHash) {
      throw new BadRequestException(
        "The validation hash does not match this CSV and target namespace. Run dry-run again.",
      );
    }

    return this.mutations.executeIdempotent(
      "catalog.menu-import.apply",
      idempotencyKey,
      input,
      principal,
      async (transaction) => {
        await this.assertBranch(
          transaction,
          input.branchId,
          principal.organizationId,
        );
        const dryRun = await this.buildDryRun(transaction, input);
        if (!dryRun.valid) {
          throw new UnprocessableEntityException({
            code: "MENU_IMPORT_VALIDATION_FAILED",
            message: "The CSV has errors and was not applied.",
            dryRun,
          });
        }

        const applied = await this.applyRows(
          transaction,
          input.branchId,
          parsed.rows,
          principal.userId,
        );
        const importRecord = await transaction.catalogImport.create({
          data: {
            branchId: input.branchId,
            createdById: principal.userId,
            schemaVersion: input.schemaVersion,
            branchCode: input.branchCode,
            menuCode: input.menuCode,
            sourceFileName: input.fileName,
            sourceHash: parsed.sourceHash,
            validationHash: expectedValidationHash,
            rowCount: parsed.rows.length,
            result: toJson({ dryRun, applied }),
          },
        });
        const response = {
          importId: importRecord.id,
          appliedAt: importRecord.appliedAt,
          sourceHash: parsed.sourceHash,
          validationHash: expectedValidationHash,
          summary: dryRun.summary,
          applied,
          issues: dryRun.issues,
        };
        return {
          branchId: input.branchId,
          entityType: "catalog_import",
          entityId: importRecord.id,
          eventType: "catalog.menu-import.applied",
          response: toJson(response),
          auditReason: input.reason,
          auditMetadata: {
            sourceHash: parsed.sourceHash,
            fileName: input.fileName,
            rowCount: parsed.rows.length,
          },
        };
      },
    );
  }

  async getResult(
    branchId: string,
    importId: string,
    principal: AuthPrincipal,
  ) {
    this.assertPermission(principal, branchId);
    const record = await this.prisma.catalogImport.findFirst({
      where: {
        id: importId,
        branchId,
        branch: { organizationId: principal.organizationId },
      },
    });
    if (!record) throw new NotFoundException("Catalog import not found.");
    return {
      id: record.id,
      schemaVersion: record.schemaVersion,
      branchCode: record.branchCode,
      menuCode: record.menuCode,
      sourceFileName: record.sourceFileName,
      sourceHash: record.sourceHash,
      validationHash: record.validationHash,
      rowCount: record.rowCount,
      result: record.result,
      appliedAt: record.appliedAt,
    };
  }

  private async buildDryRun(
    client: DatabaseClient,
    input: MenuImportDryRunRequest,
  ): Promise<DryRunResult> {
    const parsed = parseMenuImportCsv(input.csvText, {
      branchCode: input.branchCode,
      menuCode: input.menuCode,
    });
    const parserHasErrors = parsed.issues.some(
      ({ severity }) => severity === "ERROR",
    );
    const databaseIssues = parserHasErrors
      ? []
      : await this.validateDatabaseRows(client, input.branchId, parsed.rows);
    const issues = [...parsed.issues, ...databaseIssues].sort(
      (left, right) =>
        left.row - right.row || left.field.localeCompare(right.field),
    );
    const errors = issues.filter(({ severity }) => severity === "ERROR").length;
    const warnings = issues.length - errors;
    return {
      schemaVersion: "menu-v1",
      fileName: input.fileName,
      sourceHash: parsed.sourceHash,
      validationHash: menuImportValidationHash(
        parsed.sourceHash,
        input.branchId,
        input.branchCode,
        input.menuCode,
      ),
      valid: errors === 0,
      summary: {
        dataRows: parsed.rows.length,
        categories: new Set(parsed.rows.map(({ categoryCode }) => categoryCode))
          .size,
        items: new Set(parsed.rows.map(({ itemCode }) => itemCode)).size,
        variants: parsed.rows.filter(({ variantCode }) => variantCode).length,
        prices: parsed.rows.filter(({ priceMinor }) => priceMinor !== null)
          .length,
        errors,
        warnings,
      },
      issues,
    };
  }

  private async loadContext(
    client: DatabaseClient,
    branchId: string,
  ): Promise<CatalogContext> {
    const [categories, stations, taxClasses, items] = await Promise.all([
      client.category.findMany({ where: { branchId } }),
      client.station.findMany({ where: { branchId } }),
      client.taxClass.findMany({ where: { branchId } }),
      client.menuItem.findMany({
        where: { branchId },
        include: {
          prices: true,
          variants: { include: { prices: true } },
        },
      }),
    ]);
    return { categories, stations, taxClasses, items };
  }

  private async validateDatabaseRows(
    client: DatabaseClient,
    branchId: string,
    rows: ParsedMenuImportRow[],
  ): Promise<MenuImportIssue[]> {
    const context = await this.loadContext(client, branchId);
    const issues: MenuImportIssue[] = [];
    const now = new Date();
    const stations = new Map(
      context.stations
        .filter(({ externalKey }) => externalKey)
        .map((station) => [station.externalKey as string, station]),
    );
    const taxClasses = new Map(
      context.taxClasses.map((taxClass) => [
        taxClass.key.toUpperCase(),
        taxClass,
      ]),
    );
    const existingItems = new Map(
      context.items
        .filter(({ externalKey }) => externalKey)
        .map((item) => [item.externalKey as string, item]),
    );
    const baseRows = new Map(
      rows
        .filter(({ variantCode }) => variantCode === null)
        .map((row) => [row.itemCode, row]),
    );
    const add = (
      row: ParsedMenuImportRow,
      field: string,
      code: string,
      message: string,
    ) =>
      issues.push({
        row: row.rowNumber,
        field,
        severity: "ERROR",
        code,
        message,
      });

    for (const row of rows) {
      const station = row.stationCode ? stations.get(row.stationCode) : null;
      const taxClass = row.taxClassCode
        ? taxClasses.get(row.taxClassCode)
        : null;
      if (row.stationCode && !station) {
        add(
          row,
          "production_station_codes",
          "STATION_NOT_FOUND",
          `No station with external key ${row.stationCode} exists in this branch.`,
        );
      }
      if (row.taxClassCode && !taxClass) {
        add(
          row,
          "tax_class_code",
          "TAX_CLASS_NOT_FOUND",
          `No tax class with key ${row.taxClassCode} exists in this branch.`,
        );
      }
      if (row.active && station && !station.isActive) {
        add(
          row,
          "production_station_codes",
          "STATION_INACTIVE",
          "An active row cannot use an inactive production station.",
        );
      }
      if (row.active && taxClass && !taxClass.isActive) {
        add(
          row,
          "tax_class_code",
          "TAX_CLASS_INACTIVE",
          "An active row cannot use an inactive tax class.",
        );
      }

      const item = existingItems.get(row.itemCode);
      const baseRow = baseRows.get(row.itemCode);
      const targetItemActive = baseRow?.active ?? item?.isActive ?? false;
      if (targetItemActive && (!station || !station.isActive)) {
        add(
          row,
          "production_station_codes",
          "ACTIVE_ITEM_STATION_REQUIRED",
          "The resulting active item requires an active production station.",
        );
      }
      if (targetItemActive && (!taxClass || !taxClass.isActive)) {
        add(
          row,
          "tax_class_code",
          "ACTIVE_ITEM_TAX_REQUIRED",
          "The resulting active item requires an active tax class.",
        );
      }
      const basePrices = item
        ? item.prices.filter(({ menuVariantId }) => menuVariantId === null)
        : [];
      const hasExistingBasePrice = activePrice(basePrices, now).length === 1;
      if (targetItemActive && !baseRow?.priceMinor && !hasExistingBasePrice) {
        add(
          row,
          "price_ghs",
          "ACTIVE_ITEM_BASE_PRICE_REQUIRED",
          "The resulting active item requires a base-price row or an existing effective base price.",
        );
      }
      if (row.variantCode && row.active && !targetItemActive) {
        add(
          row,
          "active",
          "PARENT_ITEM_INACTIVE",
          "An active variant requires an active parent item.",
        );
      }

      const targetPrices = row.variantCode
        ? (item?.variants.find(
            ({ externalKey }) => externalKey === row.variantCode,
          )?.prices ?? [])
        : basePrices;
      if (
        row.priceMinor !== null &&
        targetPrices.some(({ effectiveFrom }) => effectiveFrom > now)
      ) {
        add(
          row,
          "price_ghs",
          "SCHEDULED_PRICE_CONFLICT",
          "A future scheduled price already exists for this target.",
        );
      }
      if (activePrice(targetPrices, now).length > 1) {
        add(
          row,
          "price_ghs",
          "OVERLAPPING_CURRENT_PRICES",
          "Existing price intervals overlap and must be repaired before import.",
        );
      }

      const categoryNameConflict = context.categories.find(
        (category) =>
          category.name.toLocaleLowerCase("en") ===
            row.categoryName.toLocaleLowerCase("en") &&
          category.externalKey !== row.categoryCode,
      );
      if (categoryNameConflict) {
        add(
          row,
          "category_name",
          "CATEGORY_NAME_CONFLICT",
          "Another category already uses this name with a different external key.",
        );
      }
      const itemNameConflict = context.items.find(
        (candidate) =>
          candidate.name.toLocaleLowerCase("en") ===
            row.itemName.toLocaleLowerCase("en") &&
          candidate.externalKey !== row.itemCode,
      );
      if (itemNameConflict) {
        add(
          row,
          "item_name",
          "ITEM_NAME_CONFLICT",
          "Another item already uses this name with a different external key.",
        );
      }
      if (row.variantCode && item) {
        const variantNameConflict = item.variants.find(
          (variant) =>
            variant.name.toLocaleLowerCase("en") ===
              row.variantName?.toLocaleLowerCase("en") &&
            variant.externalKey !== row.variantCode,
        );
        if (variantNameConflict) {
          add(
            row,
            "variant_name",
            "VARIANT_NAME_CONFLICT",
            "Another variant already uses this name with a different external key.",
          );
        }
      }
    }
    return issues;
  }

  private async applyRows(
    transaction: Prisma.TransactionClient,
    branchId: string,
    rows: ParsedMenuImportRow[],
    actorId: string,
  ) {
    const now = new Date();
    const categoryRows = new Map(
      rows.map((row) => [row.categoryCode, row] as const),
    );
    const itemRows = new Map(rows.map((row) => [row.itemCode, row] as const));
    const categoryIds = new Map<string, string>();
    const itemIds = new Map<string, string>();
    const variantIds = new Map<string, string>();
    let pricesCreated = 0;
    let pricesClosed = 0;

    for (const [externalKey, row] of categoryRows) {
      const category = await transaction.category.upsert({
        where: { branchId_externalKey: { branchId, externalKey } },
        update: { name: row.categoryName },
        create: {
          branchId,
          externalKey,
          name: row.categoryName,
          sortOrder: 0,
        },
      });
      categoryIds.set(externalKey, category.id);
    }

    const stations = await transaction.station.findMany({
      where: { branchId },
    });
    const stationIds = new Map(
      stations
        .filter(({ externalKey }) => externalKey)
        .map(({ externalKey, id }) => [externalKey as string, id]),
    );
    const taxClasses = await transaction.taxClass.findMany({
      where: { branchId },
    });
    const taxClassIds = new Map(
      taxClasses.map(({ key, id }) => [key.toUpperCase(), id]),
    );

    for (const [externalKey, row] of itemRows) {
      const item = await transaction.menuItem.upsert({
        where: { branchId_externalKey: { branchId, externalKey } },
        update: {
          categoryId: categoryIds.get(row.categoryCode) as string,
          defaultStationId: row.stationCode
            ? stationIds.get(row.stationCode)
            : null,
          taxClassId: row.taxClassCode
            ? taxClassIds.get(row.taxClassCode)
            : null,
          name: row.itemName,
          description: row.description,
          sortOrder: row.displayOrder,
          revision: { increment: 1 },
        },
        create: {
          branchId,
          externalKey,
          categoryId: categoryIds.get(row.categoryCode) as string,
          defaultStationId: row.stationCode
            ? stationIds.get(row.stationCode)
            : null,
          taxClassId: row.taxClassCode
            ? taxClassIds.get(row.taxClassCode)
            : null,
          name: row.itemName,
          description: row.description,
          sortOrder: row.displayOrder,
          isActive: false,
        },
      });
      itemIds.set(externalKey, item.id);
    }

    for (const row of rows.filter(({ variantCode }) => variantCode !== null)) {
      const menuItemId = itemIds.get(row.itemCode) as string;
      const externalKey = row.variantCode as string;
      const variant = await transaction.menuVariant.upsert({
        where: { menuItemId_externalKey: { menuItemId, externalKey } },
        update: {
          name: row.variantName as string,
          revision: { increment: 1 },
        },
        create: {
          menuItemId,
          externalKey,
          name: row.variantName as string,
          isActive: false,
        },
      });
      variantIds.set(`${row.itemCode}:${externalKey}`, variant.id);
    }

    for (const row of rows) {
      if (row.priceMinor === null) continue;
      const menuItemId = itemIds.get(row.itemCode) as string;
      const menuVariantId = row.variantCode
        ? (variantIds.get(`${row.itemCode}:${row.variantCode}`) as string)
        : null;
      const current = await transaction.menuPrice.findMany({
        where: {
          branchId,
          menuItemId,
          menuVariantId,
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
        },
      });
      const existing = current[0];
      if (existing?.amountMinor === row.priceMinor) continue;
      if (existing) {
        await transaction.menuPrice.update({
          where: { id: existing.id },
          data: { effectiveTo: now },
        });
        pricesClosed += 1;
      }
      await transaction.menuPrice.create({
        data: {
          branchId,
          menuItemId,
          menuVariantId,
          createdById: actorId,
          amountMinor: row.priceMinor,
          effectiveFrom: now,
        },
      });
      pricesCreated += 1;
    }

    for (const row of rows) {
      if (row.variantCode) {
        await transaction.menuVariant.update({
          where: {
            id: variantIds.get(`${row.itemCode}:${row.variantCode}`) as string,
          },
          data: { isActive: row.active, revision: { increment: 1 } },
        });
      } else {
        await transaction.menuItem.update({
          where: { id: itemIds.get(row.itemCode) as string },
          data: { isActive: row.active, revision: { increment: 1 } },
        });
      }
    }

    return {
      categoriesUpserted: categoryRows.size,
      itemsUpserted: itemRows.size,
      variantsUpserted: variantIds.size,
      pricesCreated,
      pricesClosed,
    };
  }

  private assertPermission(principal: AuthPrincipal, branchId: string) {
    if (!hasPermission(principal, "catalog.import", branchId)) {
      throw new ForbiddenException(
        "The user lacks catalog import permission for this branch.",
      );
    }
  }

  private async assertBranch(
    client: DatabaseClient,
    branchId: string,
    organizationId: string,
  ) {
    const branch = await client.branch.findFirst({
      where: { id: branchId, organizationId },
    });
    if (!branch) throw new NotFoundException("Branch not found.");
  }
}
