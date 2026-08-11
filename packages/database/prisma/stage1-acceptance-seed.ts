import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ids = {
  organization: "10000000-0000-4000-8000-000000000001",
  branch: "10000000-0000-4000-8000-000000000002",
  device: "10000000-0000-4000-8000-000000000003",
  station: "10000000-0000-4000-8000-000000000010",
  diningArea: "10000000-0000-4000-8000-000000000011",
  diningTable: "10000000-0000-4000-8000-000000000012",
  taxClass: "10000000-0000-4000-8000-000000000013",
  taxProfile: "10000000-0000-4000-8000-000000000014",
  taxComponent: "10000000-0000-4000-8000-000000000015",
  category: "10000000-0000-4000-8000-000000000016",
  menuItem: "10000000-0000-4000-8000-000000000017",
  menuPrice: "10000000-0000-4000-8000-000000000018",
  schedule: "10000000-0000-4000-8000-000000000019",
} as const;

const scheduleWindowIds = [
  "10000000-0000-4000-8000-000000000020",
  "10000000-0000-4000-8000-000000000021",
  "10000000-0000-4000-8000-000000000022",
  "10000000-0000-4000-8000-000000000023",
  "10000000-0000-4000-8000-000000000024",
  "10000000-0000-4000-8000-000000000025",
  "10000000-0000-4000-8000-000000000026",
] as const;

async function createAcceptanceFixture() {
  if (process.env.ALLOW_STAGE1_ACCEPTANCE_FIXTURE !== "true") {
    throw new Error(
      "Refusing to create fictional Stage 1 data unless ALLOW_STAGE1_ACCEPTANCE_FIXTURE=true.",
    );
  }

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error(
      "BOOTSTRAP_ADMIN_EMAIL is required for the acceptance fixture.",
    );
  }

  const actor = await prisma.user.findUnique({
    where: {
      organizationId_email: {
        organizationId: ids.organization,
        email,
      },
    },
    select: { id: true },
  });
  if (!actor) {
    throw new Error(
      "Run the standard development seed with bootstrap credentials before the Stage 1 fixture.",
    );
  }

  const activatedAt = new Date("2026-01-01T00:00:00.000Z");
  const effectiveDate = new Date("2020-01-01T00:00:00.000Z");

  if (!(await prisma.station.findUnique({ where: { id: ids.station } }))) {
    await prisma.station.create({
      data: {
        id: ids.station,
        branchId: ids.branch,
        externalKey: "STAGE1_KITCHEN",
        name: "FICTIONAL Stage 1 Kitchen",
        kind: "KITCHEN",
        isActive: true,
      },
    });
  }

  if (
    !(await prisma.diningArea.findUnique({ where: { id: ids.diningArea } }))
  ) {
    await prisma.diningArea.create({
      data: {
        id: ids.diningArea,
        branchId: ids.branch,
        externalKey: "STAGE1_AREA",
        name: "FICTIONAL Acceptance Area",
        nameKey: "fictional acceptance area",
        isActive: true,
      },
    });
  }

  if (
    !(await prisma.diningTable.findUnique({ where: { id: ids.diningTable } }))
  ) {
    await prisma.diningTable.create({
      data: {
        id: ids.diningTable,
        branchId: ids.branch,
        diningAreaId: ids.diningArea,
        externalKey: "STAGE1_TABLE_1",
        name: "FICTIONAL Table 1",
        nameKey: "fictional table 1",
        capacity: 4,
        isActive: true,
      },
    });
  }

  if (!(await prisma.taxClass.findUnique({ where: { id: ids.taxClass } }))) {
    await prisma.taxClass.create({
      data: {
        id: ids.taxClass,
        branchId: ids.branch,
        key: "STAGE1_ZERO_TEST",
        label: "FICTIONAL zero-rate acceptance class",
        treatment: "ZERO_RATED",
        isActive: true,
      },
    });
  }

  if (
    !(await prisma.taxProfile.findUnique({ where: { id: ids.taxProfile } }))
  ) {
    await prisma.taxProfile.create({
      data: {
        id: ids.taxProfile,
        branchId: ids.branch,
        createdById: actor.id,
        key: "STAGE1_TEST_ONLY",
        name: "FICTIONAL Stage 1 zero-rate profile",
        status: "DRAFT",
        priceMode: "EXCLUSIVE",
        roundingMode: "HALF_UP",
        roundingScope: "LINE",
        currency: "GHS",
        effectiveFrom: effectiveDate,
      },
    });
    await prisma.taxComponent.create({
      data: {
        id: ids.taxComponent,
        taxProfileId: ids.taxProfile,
        code: "STAGE1_ZERO_TEST",
        receiptLabel: "FICTIONAL TEST TAX",
        ratePpm: 0,
        calculationOrder: 0,
      },
    });
    await prisma.taxProfile.update({
      where: { id: ids.taxProfile },
      data: {
        status: "CONFIRMED",
        revision: 2,
        approvalReference: "FICTIONAL ACCEPTANCE FIXTURE - NOT TAX ADVICE",
        confirmationRecordedById: actor.id,
        confirmedAt: activatedAt,
      },
    });
    await prisma.taxProfile.update({
      where: { id: ids.taxProfile },
      data: {
        status: "ACTIVE",
        revision: 3,
        activatedById: actor.id,
        activatedAt,
      },
    });
  }

  if (!(await prisma.category.findUnique({ where: { id: ids.category } }))) {
    await prisma.category.create({
      data: {
        id: ids.category,
        branchId: ids.branch,
        externalKey: "STAGE1_CATEGORY",
        name: "FICTIONAL Acceptance Items",
        isActive: true,
      },
    });
  }

  if (!(await prisma.menuItem.findUnique({ where: { id: ids.menuItem } }))) {
    await prisma.menuItem.create({
      data: {
        id: ids.menuItem,
        branchId: ids.branch,
        externalKey: "STAGE1_ITEM",
        categoryId: ids.category,
        defaultStationId: ids.station,
        taxClassId: ids.taxClass,
        name: "FICTIONAL Acceptance Meal",
        shortName: "TEST MEAL",
        sku: "STAGE1-TEST-MEAL",
        isActive: true,
        isAvailable: true,
      },
    });
  }

  if (!(await prisma.menuPrice.findUnique({ where: { id: ids.menuPrice } }))) {
    await prisma.menuPrice.create({
      data: {
        id: ids.menuPrice,
        branchId: ids.branch,
        menuItemId: ids.menuItem,
        createdById: actor.id,
        amountMinor: 1_200,
        currency: "GHS",
        effectiveFrom: effectiveDate,
      },
    });
  }

  if (
    !(await prisma.branchScheduleVersion.findUnique({
      where: { id: ids.schedule },
    }))
  ) {
    await prisma.branchScheduleVersion.create({
      data: {
        id: ids.schedule,
        branchId: ids.branch,
        createdById: actor.id,
        effectiveFrom: effectiveDate,
        businessDayCutoffMinute: 0,
        status: "DRAFT",
      },
    });
    await prisma.branchWeeklyServiceWindow.createMany({
      data: scheduleWindowIds.map((id, index) => ({
        id,
        scheduleId: ids.schedule,
        isoWeekday: index + 1,
        opensAtMinute: 0,
        durationMinutes: 1_440,
      })),
    });
    await prisma.branchScheduleVersion.update({
      where: { id: ids.schedule },
      data: {
        status: "ACTIVE",
        revision: 2,
        activatedById: actor.id,
        activatedAt,
      },
    });
  }

  console.info(
    `Seeded explicit fictional Stage 1 acceptance fixture for branch ${ids.branch}.`,
  );
}

createAcceptanceFixture()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
