import {
  branchHoursConfigurationResponseSchema,
  branchHoursPreviewResponseSchema,
  branchScheduleResponseSchema,
  batchProductionListResponseSchema,
  batchProductionPreviewResponseSchema,
  batchProductionResponseSchema,
  batchRecipeVersionListResponseSchema,
  batchRecipeVersionResponseSchema,
  categoryListResponseSchema,
  categoryResponseSchema,
  customerConsentListResponseSchema,
  customerConsentResponseSchema,
  customerCreateResponseSchema,
  customerExportResponseSchema,
  customerSearchResponseSchema,
  deviceListResponseSchema,
  deviceResponseSchema,
  diningAreaListResponseSchema,
  diningAreaBaseResponseSchema,
  diningAreaResponseSchema,
  diningTableResponseSchema,
  dailySummaryResponseSchema,
  inventoryBalanceListResponseSchema,
  availabilityPreviewResponseSchema,
  criticalIngredientRuleListResponseSchema,
  inventoryConsumptionListResponseSchema,
  inventoryConsumptionReconciliationResponseSchema,
  inventoryConsumptionRouteListResponseSchema,
  inventoryDeductionPolicyListResponseSchema,
  inventoryItemListResponseSchema,
  inventoryItemResponseSchema,
  inventoryTransferListResponseSchema,
  inventoryTransferResponseSchema,
  inventoryUnitConversionResponseSchema,
  inventoryUnitListResponseSchema,
  inventoryUnitResponseSchema,
  modifierRecipeEffectListResponseSchema,
  modifierRecipeEffectResponseSchema,
  mfaActivationResponseSchema,
  mfaDisableResponseSchema,
  mfaEnrollmentResponseSchema,
  mfaStatusResponseSchema,
  menuImportApplyResponseSchema,
  menuImportDryRunResponseSchema,
  menuItemBaseResponseSchema,
  menuItemConfigurationListResponseSchema,
  menuPriceResponseSchema,
  menuVariantResponseSchema,
  modifierGroupListResponseSchema,
  modifierGroupResponseSchema,
  goodsReceiptListResponseSchema,
  goodsReceiptResponseSchema,
  permissionListResponseSchema,
  privacyRequestListResponseSchema,
  privacyRequestResponseSchema,
  procurementValuationResponseSchema,
  purchaseOrderListResponseSchema,
  purchaseOrderResponseSchema,
  purchaseReturnListResponseSchema,
  purchaseReturnResponseSchema,
  reportExceptionsResponseSchema,
  retentionPolicyListResponseSchema,
  retentionPolicyResponseSchema,
  retentionPreviewResponseSchema,
  recipeVersionListResponseSchema,
  recipeVersionResponseSchema,
  roleListResponseSchema,
  roleResponseSchema,
  salesBreakdownResponseSchema,
  shiftReconciliationResponseSchema,
  stationListResponseSchema,
  stationResponseSchema,
  specialHoursResponseSchema,
  staffListResponseSchema,
  staffResponseSchema,
  stockLedgerEntryResponseSchema,
  stockLedgerListResponseSchema,
  stockCountListResponseSchema,
  stockCountResponseSchema,
  postedStockCountResponseSchema,
  stockLocationListResponseSchema,
  stockLocationResponseSchema,
  supplierItemResponseSchema,
  supplierListResponseSchema,
  supplierResponseSchema,
  taxProfileListResponseSchema,
  taxProfileResponseSchema,
  taxClassListResponseSchema,
  taxClassResponseSchema,
  taxSummaryResponseSchema,
  tenderSummaryResponseSchema,
  type BranchHoursConfigurationResponse,
  type BranchHoursPreviewResponse,
  type BatchProductionPreviewResponse,
  type BatchProductionResponse,
  type BatchRecipeVersionResponse,
  type CategoryResponse,
  type CustomerConsentResponse,
  type CustomerExportResponse,
  type CustomerResponse,
  type DeviceResponse,
  type DiningAreaResponse,
  type DiningTableResponse,
  type DailySummaryResponse,
  type InventoryBalanceResponse,
  type AvailabilityPreviewResponse,
  type CriticalIngredientRuleResponse,
  type InventoryConsumptionReconciliationResponse,
  type InventoryConsumptionResponse,
  type InventoryConsumptionRouteResponse,
  type InventoryDeductionPolicyResponse,
  type InventoryItemResponse,
  type InventoryTransferResponse,
  type InventoryUnitDimension,
  type InventoryUnitResponse,
  type LoginRequest,
  type MenuImportApplyResponse,
  type MenuImportDryRunResponse,
  type MenuItemConfigurationResponse,
  type ModifierGroupResponse,
  type ModifierRecipeEffectResponse,
  type MfaEnrollmentResponse,
  type MfaStatusResponse,
  type GoodsReceiptResponse,
  type PermissionResponse,
  type PrivacyRequestResponse,
  type ProcurementValuationResponse,
  type PurchaseOrderResponse,
  type PurchaseReturnResponse,
  type ReportExceptionsResponse,
  type ReportExportDataset,
  type RetentionPolicyResponse,
  type RetentionPreviewResponse,
  type RecipeVersionResponse,
  type RoleResponse,
  type SalesBreakdownResponse,
  type SalesReportGrouping,
  type ShiftReconciliationResponse,
  type SpecialHoursResponse,
  type StaffResponse,
  type StationResponse,
  type StockLedgerEntryResponse,
  type StockCountResponse,
  type StockLocationResponse,
  type SupplierResponse,
  type TaxProfileResponse,
  type TaxClassResponse,
  type TaxSummaryResponse,
  type TenderSummaryResponse,
} from "@base-cafe/contracts";
import {
  commandKey,
  createSessionStore,
  loginDevice,
  normalizeApiV1Base,
  requestBlob,
  requestJson,
  type WebSession,
} from "@base-cafe/web-client";

const LEGACY_TOKEN_KEY = "base-cafe-admin.access-token";

// Shared schemas validate every live administration response before rendering.

function apiBase() {
  return normalizeApiV1Base(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3100",
  );
}

function store() {
  return createSessionStore("admin", window.sessionStorage);
}

function unauthorized() {
  clearAdminSession();
  window.dispatchEvent(new Event("base-cafe:admin-unauthorized"));
}

async function mutate<T>(
  session: WebSession,
  path: string,
  prefix: string,
  body: unknown,
) {
  return requestJson<T>(apiBase(), path, {
    method: "POST",
    session,
    idempotencyKey: commandKey(prefix),
    onUnauthorized: unauthorized,
    body,
  });
}

export type AdminSession = WebSession;

export function loadAdminSession() {
  return store().load();
}

export function saveAdminSession(session: WebSession) {
  store().save(session);
  window.sessionStorage.setItem(LEGACY_TOKEN_KEY, session.accessToken);
}

export function clearAdminSession() {
  store().clear();
  window.sessionStorage.removeItem(LEGACY_TOKEN_KEY);
}

export async function loginAdmin(input: LoginRequest) {
  const session = await loginDevice(apiBase(), input);
  saveAdminSession(session);
  return session;
}

export async function logoutAdmin(session: WebSession) {
  await requestJson(apiBase(), "/auth/logout", {
    method: "POST",
    session,
  }).catch(() => undefined);
  clearAdminSession();
}

export async function getMfaStatus(
  session: WebSession,
): Promise<MfaStatusResponse> {
  const response = await requestJson<unknown>(apiBase(), "/auth/mfa/status", {
    session,
    onUnauthorized: unauthorized,
  });
  return mfaStatusResponseSchema.parse(response);
}

export async function enrollMfa(
  session: WebSession,
  input: { currentPassword: string; reason: string },
): Promise<MfaEnrollmentResponse> {
  return mfaEnrollmentResponseSchema.parse(
    await mutate<unknown>(session, "/auth/mfa/enroll", "mfa-enroll", input),
  );
}

export async function activateMfa(
  session: WebSession,
  input: { code: string; revision: number; reason: string },
) {
  return mfaActivationResponseSchema.parse(
    await mutate<unknown>(session, "/auth/mfa/activate", "mfa-activate", input),
  );
}

export async function disableMfa(
  session: WebSession,
  input: {
    currentPassword: string;
    code?: string;
    recoveryCode?: string;
    revision: number;
    reason: string;
  },
) {
  return mfaDisableResponseSchema.parse(
    await mutate<unknown>(session, "/auth/mfa/disable", "mfa-disable", input),
  );
}

export async function resetPendingMfa(
  session: WebSession,
  input: { currentPassword: string; revision: number; reason: string },
) {
  return mfaDisableResponseSchema.parse(
    await mutate<unknown>(
      session,
      "/auth/mfa/reset-pending",
      "mfa-reset-pending",
      input,
    ),
  );
}

export async function listPermissions(
  session: WebSession,
): Promise<PermissionResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/administration/branches/${session.scope.branchId}/permissions`,
    { session, onUnauthorized: unauthorized },
  );
  return permissionListResponseSchema.parse(response);
}

export async function listRoles(session: WebSession): Promise<RoleResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/administration/branches/${session.scope.branchId}/roles`,
    { session, onUnauthorized: unauthorized },
  );
  return roleListResponseSchema.parse(response);
}

export async function createRole(
  session: WebSession,
  input: {
    name: string;
    scope: "ORGANIZATION" | "BRANCH";
    permissionKeys: string[];
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/administration/roles",
    "admin-role-create",
    { branchId: session.scope.branchId, ...input },
  );
  return roleResponseSchema.parse(response);
}

export async function listStaff(session: WebSession): Promise<StaffResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/administration/branches/${session.scope.branchId}/staff`,
    { session, onUnauthorized: unauthorized },
  );
  return staffListResponseSchema.parse(response);
}

export async function createStaff(
  session: WebSession,
  input: {
    displayName: string;
    email: string;
    initialPassword: string;
    roleIds: string[];
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/administration/staff",
    "admin-staff-create",
    { branchId: session.scope.branchId, ...input },
  );
  return staffResponseSchema.parse(response);
}

export async function assignStaffRole(
  session: WebSession,
  staff: StaffResponse,
  roleId: string,
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/administration/staff/${staff.id}/roles`,
    "admin-staff-role-assign",
    {
      branchId: session.scope.branchId,
      revision: staff.revision,
      roleId,
      reason,
    },
  );
  return staffResponseSchema.parse(response);
}

export async function removeStaffRole(
  session: WebSession,
  staff: StaffResponse,
  assignmentId: string,
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/administration/staff/${staff.id}/roles/${assignmentId}/remove`,
    "admin-staff-role-remove",
    { branchId: session.scope.branchId, revision: staff.revision, reason },
  );
  return staffResponseSchema.parse(response);
}

export async function changeStaffStatus(
  session: WebSession,
  staff: StaffResponse,
  action: "disable" | "reactivate",
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/administration/staff/${staff.id}/${action}`,
    `admin-staff-${action}`,
    { branchId: session.scope.branchId, revision: staff.revision, reason },
  );
  return staffResponseSchema.parse(response);
}

export async function listDevices(
  session: WebSession,
): Promise<DeviceResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/administration/branches/${session.scope.branchId}/devices`,
    { session, onUnauthorized: unauthorized },
  );
  return deviceListResponseSchema.parse(response);
}

export async function createDevice(session: WebSession, name: string) {
  const response = await mutate<unknown>(
    session,
    "/administration/devices",
    "admin-device-create",
    { branchId: session.scope.branchId, name },
  );
  return deviceResponseSchema.parse(response);
}

export async function changeDeviceStatus(
  session: WebSession,
  device: DeviceResponse,
  action: "activate" | "revoke",
  input: { reason: string; fingerprintHash?: string },
) {
  const response = await mutate<unknown>(
    session,
    `/administration/devices/${device.id}/${action}`,
    `admin-device-${action}`,
    {
      branchId: session.scope.branchId,
      revision: device.revision,
      reason: input.reason,
      ...(action === "activate"
        ? { fingerprintHash: input.fingerprintHash }
        : {}),
    },
  );
  return deviceResponseSchema.parse(response);
}

export async function listStations(
  session: WebSession,
): Promise<StationResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/catalog/branches/${session.scope.branchId}/stations`,
    { session, onUnauthorized: unauthorized },
  );
  return stationListResponseSchema.parse(response);
}

export async function createStation(
  session: WebSession,
  input: {
    externalKey?: string;
    name: string;
    kind: "KITCHEN" | "BAR" | "OTHER";
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/catalog/stations",
    "admin-station-create",
    { branchId: session.scope.branchId, ...input },
  );
  return stationResponseSchema.parse(response);
}

export async function listDiningAreas(
  session: WebSession,
): Promise<DiningAreaResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/layout/branches/${session.scope.branchId}/areas`,
    { session, onUnauthorized: unauthorized },
  );
  return diningAreaListResponseSchema.parse(response);
}

export async function createDiningArea(
  session: WebSession,
  input: {
    externalKey?: string;
    name: string;
    displayOrder: number;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/layout/areas",
    "admin-area-create",
    { branchId: session.scope.branchId, ...input },
  );
  return diningAreaResponseSchema.omit({ tables: true }).parse(response);
}

export async function changeDiningAreaStatus(
  session: WebSession,
  area: DiningAreaResponse,
  action: "activate" | "deactivate",
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/layout/areas/${area.id}/${action}`,
    `admin-area-${action}`,
    { branchId: session.scope.branchId, revision: area.revision, reason },
  );
  return diningAreaBaseResponseSchema.parse(response);
}

export async function createDiningTable(
  session: WebSession,
  input: {
    diningAreaId: string;
    externalKey?: string;
    name: string;
    capacity: number;
    displayOrder: number;
    combinableGroup?: string;
    positionX?: number;
    positionY?: number;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/layout/tables",
    "admin-table-create",
    { branchId: session.scope.branchId, ...input },
  );
  return diningTableResponseSchema.parse(response);
}

export async function changeDiningTableStatus(
  session: WebSession,
  table: DiningTableResponse,
  action: "activate" | "deactivate",
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/layout/tables/${table.id}/${action}`,
    `admin-table-${action}`,
    { branchId: session.scope.branchId, revision: table.revision, reason },
  );
  return diningTableResponseSchema.parse(response);
}

export async function getBranchHours(
  session: WebSession,
): Promise<BranchHoursConfigurationResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/branch-schedules/branches/${session.scope.branchId}`,
    { session, onUnauthorized: unauthorized },
  );
  return branchHoursConfigurationResponseSchema.parse(response);
}

export async function createBranchSchedule(
  session: WebSession,
  input: {
    effectiveFrom: string;
    businessDayCutoffMinute: number;
    windows: Array<{
      isoWeekday: number;
      opensAtMinute: number;
      durationMinutes: number;
    }>;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/branch-schedules",
    "admin-hours-schedule-create",
    { branchId: session.scope.branchId, ...input },
  );
  return branchScheduleResponseSchema.parse(response);
}

export async function changeBranchScheduleStatus(
  session: WebSession,
  schedule: BranchHoursConfigurationResponse["schedules"][number],
  action: "activate" | "cancel",
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/branch-schedules/${schedule.id}/${action}`,
    `admin-hours-schedule-${action}`,
    { branchId: session.scope.branchId, revision: schedule.revision, reason },
  );
  return branchScheduleResponseSchema.parse(response);
}

export async function createSpecialDay(
  session: WebSession,
  input: {
    localDate: string;
    kind: "CLOSED" | "CUSTOM_HOURS";
    label?: string;
    windows: Array<{ opensAtMinute: number; durationMinutes: number }>;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/branch-schedules/special-days",
    "admin-hours-special-create",
    { branchId: session.scope.branchId, ...input },
  );
  return specialHoursResponseSchema.parse(response);
}

export async function changeSpecialDayStatus(
  session: WebSession,
  special: SpecialHoursResponse,
  action: "activate" | "cancel",
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/branch-schedules/special-days/${special.id}/${action}`,
    `admin-hours-special-${action}`,
    { branchId: session.scope.branchId, revision: special.revision, reason },
  );
  return specialHoursResponseSchema.parse(response);
}

export async function previewBranchHours(
  session: WebSession,
  instant: string,
): Promise<BranchHoursPreviewResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    "/branch-schedules/resolve-preview",
    {
      method: "POST",
      session,
      onUnauthorized: unauthorized,
      body: { branchId: session.scope.branchId, instant },
    },
  );
  return branchHoursPreviewResponseSchema.parse(response);
}

export async function listTaxProfiles(
  session: WebSession,
): Promise<TaxProfileResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/tax-profiles/branches/${session.scope.branchId}`,
    { session, onUnauthorized: unauthorized },
  );
  return taxProfileListResponseSchema.parse(response);
}

export async function createTaxProfile(
  session: WebSession,
  input: {
    key: string;
    name: string;
    priceMode: "INCLUSIVE" | "EXCLUSIVE";
    roundingMode: "HALF_UP" | "HALF_EVEN" | "DOWN";
    roundingScope: "LINE" | "INVOICE";
    effectiveFrom: string;
    effectiveTo?: string;
    components: Array<{
      code: string;
      receiptLabel: string;
      ratePpm: number;
      calculationOrder: number;
    }>;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/tax-profiles",
    "admin-tax-profile-create",
    { branchId: session.scope.branchId, ...input },
  );
  return taxProfileResponseSchema.parse(response);
}

export async function updateTaxProfile(
  session: WebSession,
  profile: TaxProfileResponse,
  input: {
    name: string;
    priceMode: "INCLUSIVE" | "EXCLUSIVE";
    roundingMode: "HALF_UP" | "HALF_EVEN" | "DOWN";
    roundingScope: "LINE" | "INVOICE";
    effectiveFrom: string;
    effectiveTo?: string | null;
    components: Array<{
      code: string;
      receiptLabel: string;
      ratePpm: number;
      calculationOrder: number;
    }>;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    `/tax-profiles/${profile.id}/update`,
    "admin-tax-profile-update",
    {
      branchId: session.scope.branchId,
      revision: profile.revision,
      ...input,
    },
  );
  return taxProfileResponseSchema.parse(response);
}

export async function confirmTaxProfile(
  session: WebSession,
  profile: TaxProfileResponse,
  approvalReference: string,
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/tax-profiles/${profile.id}/confirm`,
    "admin-tax-profile-confirm",
    {
      branchId: session.scope.branchId,
      revision: profile.revision,
      approvalReference,
      reason,
    },
  );
  return taxProfileResponseSchema.parse(response);
}

export async function activateTaxProfile(
  session: WebSession,
  profile: TaxProfileResponse,
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/tax-profiles/${profile.id}/activate`,
    "admin-tax-profile-activate",
    {
      branchId: session.scope.branchId,
      revision: profile.revision,
      reason,
    },
  );
  return taxProfileResponseSchema.parse(response);
}

export async function listCategories(
  session: WebSession,
): Promise<CategoryResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/catalog/branches/${session.scope.branchId}/categories`,
    { session, onUnauthorized: unauthorized },
  );
  return categoryListResponseSchema.parse(response);
}

export async function createCategory(
  session: WebSession,
  input: {
    externalKey?: string;
    name: string;
    description?: string;
    sortOrder: number;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/catalog/categories",
    "admin-category-create",
    { branchId: session.scope.branchId, ...input },
  );
  return categoryResponseSchema.parse(response);
}

export async function listTaxClasses(
  session: WebSession,
): Promise<TaxClassResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/catalog/branches/${session.scope.branchId}/tax-classes`,
    { session, onUnauthorized: unauthorized },
  );
  return taxClassListResponseSchema.parse(response);
}

export async function createTaxClass(
  session: WebSession,
  input: {
    key: string;
    label: string;
    treatment: "STANDARD" | "ZERO_RATED" | "EXEMPT" | "OUT_OF_SCOPE";
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/catalog/tax-classes",
    "admin-tax-class-create",
    { branchId: session.scope.branchId, ...input },
  );
  return taxClassResponseSchema.parse(response);
}

export async function activateTaxClass(
  session: WebSession,
  taxClass: TaxClassResponse,
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/catalog/tax-classes/${taxClass.id}/activate`,
    "admin-tax-class-activate",
    {
      branchId: session.scope.branchId,
      revision: taxClass.revision,
      reason,
    },
  );
  return taxClassResponseSchema.parse(response);
}

export async function listMenuItems(
  session: WebSession,
): Promise<MenuItemConfigurationResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/catalog/branches/${session.scope.branchId}/items`,
    { session, onUnauthorized: unauthorized },
  );
  return menuItemConfigurationListResponseSchema.parse(response);
}

export async function createMenuItem(
  session: WebSession,
  input: {
    externalKey?: string;
    categoryId: string;
    defaultStationId?: string;
    taxClassId?: string;
    name: string;
    shortName?: string;
    description?: string;
    sku?: string;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/catalog/items",
    "admin-menu-item-create",
    {
      branchId: session.scope.branchId,
      ...input,
      isActive: false,
      isAvailable: true,
    },
  );
  return menuItemBaseResponseSchema.parse(response);
}

export async function updateMenuItemName(
  session: WebSession,
  item: MenuItemConfigurationResponse,
  name: string,
  reason: string,
) {
  const response = await requestJson<unknown>(
    apiBase(),
    `/catalog/items/${item.id}`,
    {
      method: "PATCH",
      session,
      idempotencyKey: commandKey("admin-menu-item-update"),
      onUnauthorized: unauthorized,
      body: {
        branchId: session.scope.branchId,
        revision: item.revision,
        name,
        reason,
      },
    },
  );
  return menuItemBaseResponseSchema.parse(response);
}

export async function changeMenuItemStatus(
  session: WebSession,
  item: MenuItemConfigurationResponse,
  action: "activate" | "deactivate",
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/catalog/items/${item.id}/${action}`,
    `admin-menu-item-${action}`,
    {
      branchId: session.scope.branchId,
      revision: item.revision,
      reason,
    },
  );
  return menuItemBaseResponseSchema.parse(response);
}

export async function createMenuVariant(
  session: WebSession,
  item: MenuItemConfigurationResponse,
  input: { externalKey?: string; name: string; sku?: string; reason: string },
) {
  const response = await mutate<unknown>(
    session,
    `/catalog/items/${item.id}/variants`,
    "admin-menu-variant-create",
    {
      branchId: session.scope.branchId,
      ...input,
      isActive: false,
      isAvailable: true,
    },
  );
  return menuVariantResponseSchema.parse(response);
}

export async function activateMenuVariant(
  session: WebSession,
  item: MenuItemConfigurationResponse,
  variant: MenuItemConfigurationResponse["variants"][number],
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/catalog/items/${item.id}/variants/${variant.id}/activate`,
    "admin-menu-variant-activate",
    {
      branchId: session.scope.branchId,
      revision: variant.revision,
      reason,
    },
  );
  return menuVariantResponseSchema.parse(response);
}

export async function createMenuPrice(
  session: WebSession,
  input: {
    menuItemId: string;
    menuVariantId?: string;
    amountMinor: number;
    effectiveFrom: string;
    effectiveTo?: string;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/catalog/prices",
    "admin-menu-price-create",
    { branchId: session.scope.branchId, ...input },
  );
  return menuPriceResponseSchema.parse(response);
}

export async function listModifierGroups(
  session: WebSession,
): Promise<ModifierGroupResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/catalog/branches/${session.scope.branchId}/modifier-groups`,
    { session, onUnauthorized: unauthorized },
  );
  return modifierGroupListResponseSchema.parse(response);
}

export async function createModifierGroup(
  session: WebSession,
  input: {
    name: string;
    minimum: number;
    maximum: number;
    isRequired: boolean;
    freeSelectionCount: number;
    modifiers: Array<{
      name: string;
      stationId?: string;
      priceDeltaMinor: number;
      isAvailable: boolean;
    }>;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/catalog/modifier-groups",
    "admin-modifier-group-create",
    { branchId: session.scope.branchId, ...input },
  );
  return modifierGroupResponseSchema.parse(response);
}

export async function attachModifierGroup(
  session: WebSession,
  item: MenuItemConfigurationResponse,
  group: ModifierGroupResponse,
  sortOrder: number,
  reason: string,
) {
  return mutate<unknown>(
    session,
    `/catalog/items/${item.id}/modifier-groups/${group.id}`,
    "admin-modifier-group-attach",
    { branchId: session.scope.branchId, sortOrder, reason },
  );
}

export async function dryRunMenuImport(
  session: WebSession,
  input: {
    branchCode: string;
    menuCode: string;
    fileName: string;
    csvText: string;
  },
): Promise<MenuImportDryRunResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    "/catalog/imports/menu/dry-run",
    {
      method: "POST",
      session,
      onUnauthorized: unauthorized,
      body: {
        branchId: session.scope.branchId,
        schemaVersion: "menu-v1",
        ...input,
      },
    },
  );
  return menuImportDryRunResponseSchema.parse(response);
}

export async function applyMenuImport(
  session: WebSession,
  input: {
    branchCode: string;
    menuCode: string;
    fileName: string;
    csvText: string;
    validationHash: string;
    reason: string;
  },
): Promise<MenuImportApplyResponse> {
  const response = await mutate<unknown>(
    session,
    "/catalog/imports/menu/apply",
    "admin-menu-import-apply",
    {
      branchId: session.scope.branchId,
      schemaVersion: "menu-v1",
      ...input,
    },
  );
  return menuImportApplyResponseSchema.parse(response);
}

type ReportRange = { fromDate: string; toDate: string };

function reportQuery(range: ReportRange, extra?: Record<string, string>) {
  const query = new URLSearchParams({ ...range, ...extra });
  return query.toString();
}

export async function getDailySummary(
  session: WebSession,
  range: ReportRange,
): Promise<DailySummaryResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/reports/branches/${session.scope.branchId}/daily-summary?${reportQuery(range)}`,
    { session, onUnauthorized: unauthorized },
  );
  return dailySummaryResponseSchema.parse(response);
}

export async function getSalesBreakdown(
  session: WebSession,
  range: ReportRange,
  groupBy: SalesReportGrouping,
): Promise<SalesBreakdownResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/reports/branches/${session.scope.branchId}/sales-breakdown?${reportQuery(range, { groupBy })}`,
    { session, onUnauthorized: unauthorized },
  );
  return salesBreakdownResponseSchema.parse(response);
}

export async function getTenderSummary(
  session: WebSession,
  range: ReportRange,
): Promise<TenderSummaryResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/reports/branches/${session.scope.branchId}/tender-summary?${reportQuery(range)}`,
    { session, onUnauthorized: unauthorized },
  );
  return tenderSummaryResponseSchema.parse(response);
}

export async function getTaxSummary(
  session: WebSession,
  range: ReportRange,
): Promise<TaxSummaryResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/reports/branches/${session.scope.branchId}/tax-summary?${reportQuery(range)}`,
    { session, onUnauthorized: unauthorized },
  );
  return taxSummaryResponseSchema.parse(response);
}

export async function getShiftReconciliation(
  session: WebSession,
  range: ReportRange,
): Promise<ShiftReconciliationResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/reports/branches/${session.scope.branchId}/shift-reconciliation?${reportQuery(range)}`,
    { session, onUnauthorized: unauthorized },
  );
  return shiftReconciliationResponseSchema.parse(response);
}

export async function getReportExceptions(
  session: WebSession,
  range: ReportRange,
): Promise<ReportExceptionsResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/reports/branches/${session.scope.branchId}/exceptions?${reportQuery(range, { limit: "100" })}`,
    { session, onUnauthorized: unauthorized },
  );
  return reportExceptionsResponseSchema.parse(response);
}

export async function downloadReportCsv(
  session: WebSession,
  dataset: ReportExportDataset,
  range: ReportRange,
) {
  const result = await requestBlob(
    apiBase(),
    `/reports/branches/${session.scope.branchId}/exports/${dataset}.csv?${reportQuery(range)}`,
    { session, onUnauthorized: unauthorized },
  );
  const filename = result.filename ?? `${dataset.toLowerCase()}.csv`;
  const url = URL.createObjectURL(result.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}

export async function listInventoryUnits(
  session: WebSession,
): Promise<InventoryUnitResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory/branches/${session.scope.branchId}/units?limit=500&includeInactive=true`,
    { session, onUnauthorized: unauthorized },
  );
  return inventoryUnitListResponseSchema.parse(response);
}

export async function listInventoryDeductionPolicies(
  session: WebSession,
): Promise<InventoryDeductionPolicyResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory-consumption/branches/${session.scope.branchId}/policies`,
    { session, onUnauthorized: unauthorized },
  );
  return inventoryDeductionPolicyListResponseSchema.parse(response);
}

export async function createInventoryDeductionPolicy(
  session: WebSession,
  input: {
    trigger: "SENT" | "PREPARED" | "SERVED" | "COMPLETED";
    effectiveFrom: string;
    reason: string;
  },
) {
  const id = crypto.randomUUID();
  await mutate<unknown>(
    session,
    "/inventory-consumption/policies",
    "admin-inventory-policy-create",
    {
      policyVersionId: id,
      branchId: session.scope.branchId,
      ...input,
    },
  );
  const rows = await listInventoryDeductionPolicies(session);
  return rows.find((row) => row.id === id) ?? null;
}

export async function listInventoryConsumptionRoutes(
  session: WebSession,
): Promise<InventoryConsumptionRouteResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory-consumption/branches/${session.scope.branchId}/routes`,
    { session, onUnauthorized: unauthorized },
  );
  return inventoryConsumptionRouteListResponseSchema.parse(response);
}

export async function createInventoryConsumptionRoute(
  session: WebSession,
  input: {
    inventoryItemId: string;
    stationId?: string;
    locationId: string;
    effectiveFrom: string;
    reason: string;
  },
) {
  const id = crypto.randomUUID();
  await mutate<unknown>(
    session,
    "/inventory-consumption/routes",
    "admin-inventory-route-create",
    {
      routeVersionId: id,
      branchId: session.scope.branchId,
      ...input,
      stationId: input.stationId || null,
    },
  );
  const rows = await listInventoryConsumptionRoutes(session);
  return rows.find((row) => row.id === id) ?? null;
}

export async function listInventoryConsumptions(
  session: WebSession,
): Promise<InventoryConsumptionResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory-consumption/branches/${session.scope.branchId}?limit=100`,
    { session, onUnauthorized: unauthorized },
  );
  return inventoryConsumptionListResponseSchema.parse(response);
}

export async function getInventoryConsumptionReconciliation(
  session: WebSession,
): Promise<InventoryConsumptionReconciliationResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory-consumption/branches/${session.scope.branchId}/reconciliation`,
    { session, onUnauthorized: unauthorized },
  );
  return inventoryConsumptionReconciliationResponseSchema.parse(response);
}

export async function listCriticalIngredientRules(
  session: WebSession,
): Promise<CriticalIngredientRuleResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory-availability/branches/${session.scope.branchId}/rules`,
    { session, onUnauthorized: unauthorized },
  );
  return criticalIngredientRuleListResponseSchema.parse(response);
}

export async function createCriticalIngredientRule(
  session: WebSession,
  input: {
    menuItemId: string;
    menuVariantId?: string;
    recipeVersionId: string;
    effectiveFrom: string;
    components: Array<{
      inventoryItemId: string;
      safetyStockMicros: string;
      locationIds: string[];
    }>;
    reason: string;
  },
) {
  const id = crypto.randomUUID();
  await mutate<unknown>(
    session,
    "/inventory-availability/rules",
    "admin-critical-ingredient-rule-create",
    {
      ruleVersionId: id,
      branchId: session.scope.branchId,
      ...input,
      menuVariantId: input.menuVariantId || null,
    },
  );
  const rows = await listCriticalIngredientRules(session);
  return rows.find((row) => row.id === id) ?? null;
}

export async function previewInventoryAvailability(
  session: WebSession,
  input: {
    menuItemId: string;
    menuVariantId?: string;
    quantity: number;
    at: string;
  },
): Promise<AvailabilityPreviewResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    "/inventory-availability/preview",
    {
      method: "POST",
      session,
      onUnauthorized: unauthorized,
      body: {
        branchId: session.scope.branchId,
        ...input,
        menuVariantId: input.menuVariantId || null,
      },
    },
  );
  return availabilityPreviewResponseSchema.parse(response);
}

export async function listStockLocations(
  session: WebSession,
): Promise<StockLocationResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory/branches/${session.scope.branchId}/locations?limit=500&includeInactive=true`,
    { session, onUnauthorized: unauthorized },
  );
  return stockLocationListResponseSchema.parse(response);
}

export async function listInventoryItems(
  session: WebSession,
): Promise<InventoryItemResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory/branches/${session.scope.branchId}/items?limit=500&includeInactive=true`,
    { session, onUnauthorized: unauthorized },
  );
  return inventoryItemListResponseSchema.parse(response);
}

export async function listStockLedger(
  session: WebSession,
): Promise<StockLedgerEntryResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory/branches/${session.scope.branchId}/ledger?limit=100`,
    { session, onUnauthorized: unauthorized },
  );
  return stockLedgerListResponseSchema.parse(response);
}

export async function listInventoryBalances(
  session: WebSession,
): Promise<InventoryBalanceResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory/branches/${session.scope.branchId}/balances`,
    { session, onUnauthorized: unauthorized },
  );
  return inventoryBalanceListResponseSchema.parse(response);
}

export async function createInventoryUnit(
  session: WebSession,
  input: {
    code: string;
    name: string;
    dimension: InventoryUnitDimension;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/inventory/units",
    "admin-inventory-unit-create",
    {
      unitId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      ...input,
    },
  );
  return inventoryUnitResponseSchema.parse(response);
}

export async function createInventoryUnitConversion(
  session: WebSession,
  input: {
    fromUnitId: string;
    toUnitId: string;
    numerator: string;
    denominator: string;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/inventory/unit-conversions",
    "admin-inventory-conversion-create",
    {
      conversionId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      ...input,
    },
  );
  return inventoryUnitConversionResponseSchema.parse(response);
}

export async function createStockLocation(
  session: WebSession,
  input: {
    externalKey: string;
    name: string;
    kind: "STORE" | "KITCHEN" | "BAR" | "OTHER";
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/inventory/locations",
    "admin-stock-location-create",
    {
      locationId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      ...input,
    },
  );
  return stockLocationResponseSchema.parse(response);
}

export async function createInventoryItem(
  session: WebSession,
  input: {
    externalKey: string;
    name: string;
    baseUnitId: string;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/inventory/items",
    "admin-inventory-item-create",
    {
      inventoryItemId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      ...input,
    },
  );
  return inventoryItemResponseSchema.parse(response);
}

export async function postStockAdjustment(
  session: WebSession,
  input: {
    locationId: string;
    inventoryItemId: string;
    type: "OPENING_BALANCE" | "MANUAL_ADJUSTMENT" | "WASTE";
    quantityDeltaMicros: string;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/inventory/adjustments",
    "admin-inventory-adjustment-post",
    {
      ledgerEntryId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      allowNegativeOverride: false,
      ...input,
    },
  );
  return stockLedgerEntryResponseSchema.parse(response);
}

export async function listInventoryTransfers(
  session: WebSession,
): Promise<InventoryTransferResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory/branches/${session.scope.branchId}/transfers?limit=500`,
    { session, onUnauthorized: unauthorized },
  );
  return inventoryTransferListResponseSchema.parse(response);
}

export async function postInventoryTransfer(
  session: WebSession,
  input: {
    inventoryItemId: string;
    fromLocationId: string;
    toLocationId: string;
    quantityMicros: string;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/inventory/transfers",
    "admin-inventory-transfer-post",
    {
      transferId: crypto.randomUUID(),
      outboundEntryId: crypto.randomUUID(),
      inboundEntryId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      allowNegativeOverride: false,
      ...input,
    },
  );
  return inventoryTransferResponseSchema.parse(response);
}

export async function listStockCounts(
  session: WebSession,
): Promise<StockCountResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory/branches/${session.scope.branchId}/counts?limit=500`,
    { session, onUnauthorized: unauthorized },
  );
  return stockCountListResponseSchema.parse(response);
}

export async function createStockCount(
  session: WebSession,
  input: {
    locationId: string;
    lines: Array<{
      inventoryItemId: string;
      countedQuantityMicros: string;
    }>;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/inventory/counts",
    "admin-inventory-count-create",
    {
      stockCountId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      ...input,
    },
  );
  return stockCountResponseSchema.parse(response);
}

export async function postStockCount(
  session: WebSession,
  count: StockCountResponse,
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/inventory/counts/${count.id}/post`,
    "admin-inventory-count-post",
    {
      branchId: session.scope.branchId,
      revision: count.revision,
      reason,
    },
  );
  return postedStockCountResponseSchema.parse(response);
}

export async function listRecipeVersions(
  session: WebSession,
): Promise<RecipeVersionResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory/branches/${session.scope.branchId}/recipes?limit=500&includeInactive=true`,
    { session, onUnauthorized: unauthorized },
  );
  return recipeVersionListResponseSchema.parse(response);
}

export async function createRecipeVersion(
  session: WebSession,
  input: {
    menuItemId: string;
    menuVariantId?: string;
    yieldQuantityMicros: string;
    effectiveFrom: string;
    components: Array<{
      inventoryItemId: string;
      quantityMicros: string;
    }>;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/inventory/recipes",
    "admin-inventory-recipe-create",
    {
      recipeVersionId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      menuItemId: input.menuItemId,
      menuVariantId: input.menuVariantId || null,
      yieldQuantityMicros: input.yieldQuantityMicros,
      effectiveFrom: input.effectiveFrom,
      components: input.components,
      reason: input.reason,
    },
  );
  return recipeVersionResponseSchema.parse(response);
}

export async function activateRecipeVersion(
  session: WebSession,
  recipe: RecipeVersionResponse,
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/inventory/recipes/${recipe.id}/activate`,
    "admin-inventory-recipe-activate",
    {
      branchId: session.scope.branchId,
      revision: recipe.revision,
      reason,
    },
  );
  return recipeVersionResponseSchema.parse(response);
}

export async function listModifierRecipeEffects(
  session: WebSession,
): Promise<ModifierRecipeEffectResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory-production/branches/${session.scope.branchId}/modifier-effects`,
    { session, onUnauthorized: unauthorized },
  );
  return modifierRecipeEffectListResponseSchema.parse(response);
}

export async function createModifierRecipeEffect(
  session: WebSession,
  input: {
    menuModifierId: string;
    components: Array<{
      inventoryItemId: string;
      kind: "ADD" | "REMOVE" | "REPLACE_ADD" | "REPLACE_REMOVE";
      quantityMicros: string;
    }>;
    effectiveFrom: string;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/inventory-production/modifier-effects",
    "admin-inventory-modifier-effect-create",
    {
      effectVersionId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      menuModifierId: input.menuModifierId,
      affectsInventory: true,
      effectiveFrom: input.effectiveFrom,
      components: input.components,
      reason: input.reason,
    },
  );
  return modifierRecipeEffectResponseSchema.parse(response);
}

export async function activateModifierRecipeEffect(
  session: WebSession,
  effect: ModifierRecipeEffectResponse,
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/inventory-production/modifier-effects/${effect.id}/activate`,
    "admin-inventory-modifier-effect-activate",
    {
      branchId: session.scope.branchId,
      revision: effect.revision,
      reason,
    },
  );
  return modifierRecipeEffectResponseSchema.parse(response);
}

export async function listBatchRecipeVersions(
  session: WebSession,
): Promise<BatchRecipeVersionResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory-production/branches/${session.scope.branchId}/batch-recipes`,
    { session, onUnauthorized: unauthorized },
  );
  return batchRecipeVersionListResponseSchema.parse(response);
}

export async function createBatchRecipeVersion(
  session: WebSession,
  input: {
    outputInventoryItemId: string;
    yieldQuantityMicros: string;
    effectiveFrom: string;
    components: Array<{
      inventoryItemId: string;
      quantityMicros: string;
    }>;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/inventory-production/batch-recipes",
    "admin-batch-recipe-create",
    {
      batchRecipeVersionId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      ...input,
    },
  );
  return batchRecipeVersionResponseSchema.parse(response);
}

export async function activateBatchRecipeVersion(
  session: WebSession,
  recipe: BatchRecipeVersionResponse,
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/inventory-production/batch-recipes/${recipe.id}/activate`,
    "admin-batch-recipe-activate",
    {
      branchId: session.scope.branchId,
      revision: recipe.revision,
      reason,
    },
  );
  return batchRecipeVersionResponseSchema.parse(response);
}

export async function listBatchProductions(
  session: WebSession,
): Promise<BatchProductionResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/inventory-production/branches/${session.scope.branchId}/batches?limit=200`,
    { session, onUnauthorized: unauthorized },
  );
  return batchProductionListResponseSchema.parse(response);
}

export async function previewBatchProduction(
  session: WebSession,
  input: {
    batchRecipeVersionId: string;
    outputQuantityMicros: string;
    outputLocationId: string;
    inputLocations: Array<{ inventoryItemId: string; locationId: string }>;
    occurredAt: string;
  },
): Promise<BatchProductionPreviewResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    "/inventory-production/batches/preview",
    {
      method: "POST",
      session,
      onUnauthorized: unauthorized,
      body: { branchId: session.scope.branchId, ...input },
    },
  );
  return batchProductionPreviewResponseSchema.parse(response);
}

export async function postBatchProduction(
  session: WebSession,
  preview: BatchProductionPreviewResponse,
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    "/inventory-production/batches",
    "admin-batch-production-post",
    {
      productionId: crypto.randomUUID(),
      outputLedgerEntryId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      batchRecipeVersionId: preview.batchRecipeVersionId,
      outputQuantityMicros: preview.outputQuantityMicros,
      outputLocationId: preview.outputLocationId,
      inputLocations: preview.inputs.map((input) => ({
        inventoryItemId: input.inventoryItemId,
        locationId: input.locationId,
      })),
      occurredAt: preview.occurredAt,
      inputLedgerEntries: preview.inputs.map((input) => ({
        inventoryItemId: input.inventoryItemId,
        ledgerEntryId: crypto.randomUUID(),
      })),
      allowNegativeOverride: false,
      reason,
    },
  );
  return batchProductionResponseSchema.parse(response);
}

export async function reverseBatchProduction(
  session: WebSession,
  production: BatchProductionResponse,
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/inventory-production/batches/${production.id}/reverse`,
    "admin-batch-production-reverse",
    {
      reversalId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      productionRevision: production.revision,
      allowNegativeOverride: false,
      ledgerEntries: [
        production.outputLedgerEntryId,
        ...production.inputs.map((input) => input.ledgerEntryId),
      ].map((originalLedgerEntryId) => ({
        originalLedgerEntryId,
        reversalLedgerEntryId: crypto.randomUUID(),
      })),
      reason,
    },
  );
  return batchProductionResponseSchema.parse(response);
}

export async function listSuppliers(
  session: WebSession,
): Promise<SupplierResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/procurement/branches/${session.scope.branchId}/suppliers?limit=200&includeInactive=true`,
    { session, onUnauthorized: unauthorized },
  );
  return supplierListResponseSchema.parse(response);
}

export async function createSupplier(
  session: WebSession,
  input: {
    externalKey: string;
    name: string;
    contactName?: string;
    phone?: string;
    email?: string;
    paymentTerms?: string;
    leadTimeDays?: number;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/procurement/suppliers",
    "admin-procurement-supplier-create",
    {
      supplierId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      ...input,
    },
  );
  return supplierResponseSchema.parse(response);
}

export async function createSupplierItem(
  session: WebSession,
  input: {
    supplierId: string;
    inventoryItemId: string;
    purchaseUnitId: string;
    supplierSku?: string;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/procurement/supplier-items",
    "admin-procurement-supplier-item-create",
    {
      supplierItemId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      ...input,
    },
  );
  return supplierItemResponseSchema.parse(response);
}

export async function listPurchaseOrders(
  session: WebSession,
): Promise<PurchaseOrderResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/procurement/branches/${session.scope.branchId}/purchase-orders?limit=200`,
    { session, onUnauthorized: unauthorized },
  );
  return purchaseOrderListResponseSchema.parse(response);
}

export async function createPurchaseOrder(
  session: WebSession,
  input: {
    supplierId: string;
    clientReference: string;
    expectedAt?: string;
    lines: Array<{
      supplierItemId: string;
      orderedQuantityMicros: string;
      unitCostMinor: number;
    }>;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/procurement/purchase-orders",
    "admin-procurement-order-create",
    {
      purchaseOrderId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      ...input,
      expectedAt: input.expectedAt || null,
      lines: input.lines.map((line) => ({
        purchaseOrderLineId: crypto.randomUUID(),
        ...line,
      })),
    },
  );
  return purchaseOrderResponseSchema.parse(response);
}

export async function transitionPurchaseOrder(
  session: WebSession,
  order: PurchaseOrderResponse,
  action: "submit" | "cancel",
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/procurement/purchase-orders/${order.id}/${action}`,
    `admin-procurement-order-${action}`,
    {
      branchId: session.scope.branchId,
      revision: order.revision,
      reason,
    },
  );
  return purchaseOrderResponseSchema.parse(response);
}

export async function listGoodsReceipts(
  session: WebSession,
): Promise<GoodsReceiptResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/procurement/branches/${session.scope.branchId}/goods-receipts?limit=200`,
    { session, onUnauthorized: unauthorized },
  );
  return goodsReceiptListResponseSchema.parse(response);
}

export async function postGoodsReceipt(
  session: WebSession,
  order: PurchaseOrderResponse,
  input: {
    supplierDocumentReference?: string;
    receivedAt: string;
    lines: Array<{
      purchaseOrderLineId: string;
      locationId: string;
      receivedQuantityMicros: string;
      lotReference?: string;
      expiresOn?: string;
    }>;
    reason: string;
  },
) {
  const response = await mutate<{ receipt: unknown }>(
    session,
    `/procurement/purchase-orders/${order.id}/receipts`,
    "admin-procurement-receipt-post",
    {
      goodsReceiptId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      purchaseOrderRevision: order.revision,
      ...input,
      supplierDocumentReference: input.supplierDocumentReference || null,
      lines: input.lines.map((line) => ({
        goodsReceiptLineId: crypto.randomUUID(),
        stockLedgerEntryId: crypto.randomUUID(),
        ...line,
        lotReference: line.lotReference || null,
        expiresOn: line.expiresOn || null,
      })),
    },
  );
  return goodsReceiptResponseSchema.parse(response.receipt);
}

export async function listPurchaseReturns(
  session: WebSession,
): Promise<PurchaseReturnResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/procurement/branches/${session.scope.branchId}/purchase-returns?limit=200`,
    { session, onUnauthorized: unauthorized },
  );
  return purchaseReturnListResponseSchema.parse(response);
}

export async function postPurchaseReturn(
  session: WebSession,
  receipt: GoodsReceiptResponse,
  input: {
    supplierDocumentReference?: string;
    returnedAt: string;
    lines: Array<{
      goodsReceiptLineId: string;
      returnedQuantityMicros: string;
    }>;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    `/procurement/goods-receipts/${receipt.id}/returns`,
    "admin-procurement-return-post",
    {
      purchaseReturnId: crypto.randomUUID(),
      branchId: session.scope.branchId,
      ...input,
      supplierDocumentReference: input.supplierDocumentReference || null,
      allowNegativeOverride: false,
      lines: input.lines.map((line) => ({
        purchaseReturnLineId: crypto.randomUUID(),
        stockLedgerEntryId: crypto.randomUUID(),
        ...line,
      })),
    },
  );
  return purchaseReturnResponseSchema.parse(response);
}

export async function loadProcurementValuation(
  session: WebSession,
): Promise<ProcurementValuationResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/procurement/branches/${session.scope.branchId}/valuation-preview`,
    { session, onUnauthorized: unauthorized },
  );
  return procurementValuationResponseSchema.parse(response);
}

export async function createCustomerProfile(
  session: WebSession,
  input: {
    displayName?: string;
    phone?: string;
    email?: string;
    notes?: string;
    preferredContactChannel?: "PHONE" | "SMS" | "EMAIL" | "WHATSAPP";
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/customers",
    "admin-privacy-customer-create",
    {
      customerId: crypto.randomUUID(),
      ...input,
      displayName: input.displayName || null,
      phone: input.phone || null,
      email: input.email || null,
      notes: input.notes || null,
      preferredContactChannel: input.preferredContactChannel || null,
      legalHoldUntil: null,
    },
  );
  return customerCreateResponseSchema.parse(response);
}

export async function searchCustomers(
  session: WebSession,
  input: { phone?: string; email?: string; reason: string },
): Promise<CustomerResponse[]> {
  const query = new URLSearchParams({ limit: "20" });
  if (input.phone) query.set("phone", input.phone);
  if (input.email) query.set("email", input.email);
  const response = await requestJson<unknown>(
    apiBase(),
    `/customers/search?${query.toString()}`,
    {
      session,
      onUnauthorized: unauthorized,
      headers: { "X-Customer-Data-Reason": input.reason },
    },
  );
  return customerSearchResponseSchema.parse(response).items;
}

export async function exportCustomerData(
  session: WebSession,
  customerId: string,
  reason: string,
): Promise<CustomerExportResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/customers/${customerId}/export`,
    {
      session,
      onUnauthorized: unauthorized,
      headers: { "X-Customer-Data-Reason": reason },
    },
  );
  return customerExportResponseSchema.parse(response);
}

export async function listCustomerConsents(
  session: WebSession,
  customerId: string,
): Promise<CustomerConsentResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    `/customers/${customerId}/consents`,
    { session, onUnauthorized: unauthorized },
  );
  return customerConsentListResponseSchema.parse(response);
}

export async function recordCustomerConsent(
  session: WebSession,
  customerId: string,
  input: {
    purpose: "OPERATIONAL_CONTACT" | "MARKETING";
    channel: "PHONE" | "SMS" | "EMAIL" | "WHATSAPP";
    status: "GRANTED" | "WITHDRAWN";
    source: string;
    wordingVersion: string;
    occurredAt: string;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    `/customers/${customerId}/consents`,
    "admin-privacy-consent-record",
    { eventId: crypto.randomUUID(), ...input },
  );
  return customerConsentResponseSchema.parse(response);
}

export async function listPrivacyRequests(
  session: WebSession,
): Promise<PrivacyRequestResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    "/privacy-requests?limit=100",
    { session, onUnauthorized: unauthorized },
  );
  return privacyRequestListResponseSchema.parse(response);
}

export async function createCustomerPrivacyRequest(
  session: WebSession,
  customerId: string,
  input: {
    requestType: "ACCESS" | "CORRECTION" | "RESTRICTION" | "ANONYMIZATION";
    dueAt?: string;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    `/customers/${customerId}/privacy-requests`,
    "admin-privacy-request-create",
    {
      requestId: crypto.randomUUID(),
      requestType: input.requestType,
      dueAt: input.dueAt || null,
      reason: input.reason,
    },
  );
  return privacyRequestResponseSchema.parse(response);
}

export async function transitionCustomerPrivacyRequest(
  session: WebSession,
  request: PrivacyRequestResponse,
  status:
    | "IDENTITY_VERIFIED"
    | "IN_PROGRESS"
    | "COMPLETED"
    | "REJECTED"
    | "CANCELLED",
  reason: string,
) {
  const response = await mutate<unknown>(
    session,
    `/privacy-requests/${request.id}/transition`,
    "admin-privacy-request-transition",
    { revision: request.revision, status, reason },
  );
  return privacyRequestResponseSchema.parse(response);
}

export async function listRetentionPolicies(
  session: WebSession,
): Promise<RetentionPolicyResponse[]> {
  const response = await requestJson<unknown>(
    apiBase(),
    "/privacy/retention-policies",
    { session, onUnauthorized: unauthorized },
  );
  return retentionPolicyListResponseSchema.parse(response);
}

export async function createRetentionPolicy(
  session: WebSession,
  input: {
    category: "CUSTOMER_PROFILE" | "ORDER_CONTACT" | "DELIVERY_DIRECTIONS";
    version: number;
    durationDays: number;
    reason: string;
  },
) {
  const response = await mutate<unknown>(
    session,
    "/privacy/retention-policies",
    "admin-privacy-retention-create",
    { policyId: crypto.randomUUID(), ...input },
  );
  return retentionPolicyResponseSchema.parse(response);
}

export async function previewRetentionPolicy(
  session: WebSession,
  policyId: string,
  asOf: string,
  reason: string,
): Promise<RetentionPreviewResponse> {
  const response = await requestJson<unknown>(
    apiBase(),
    "/privacy/retention-preview",
    {
      method: "POST",
      session,
      onUnauthorized: unauthorized,
      body: { policyId, asOf, reason },
    },
  );
  return retentionPreviewResponseSchema.parse(response);
}
