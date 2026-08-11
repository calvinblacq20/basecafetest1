import { hash } from "@node-rs/argon2";
import { PrismaClient, RoleScope } from "@prisma/client";

const prisma = new PrismaClient();

const demoOrganizationId = "10000000-0000-4000-8000-000000000001";
const demoBranchId = "10000000-0000-4000-8000-000000000002";
const demoDeviceId = "10000000-0000-4000-8000-000000000003";
const ownerRoleId = "10000000-0000-4000-8000-000000000004";

const permissions = [
  ["catalog.read", "View catalog configuration"],
  ["catalog.write", "Create and change catalog configuration"],
  ["catalog.import", "Dry-run and apply validated catalog CSV imports"],
  [
    "catalog.availability.read",
    "View resolved and manual catalog availability",
  ],
  [
    "catalog.availability.manage",
    "Record and restore audited manual catalog availability",
  ],
  ["layout.read", "View dining areas and table configuration"],
  ["layout.manage", "Create and change dining areas and tables"],
  ["branch-hours.read", "View branch schedules and business-date previews"],
  ["branch-hours.manage", "Create and activate branch hours configuration"],
  ["shifts.read", "View branch cashier shifts"],
  ["shifts.open", "Open a device-bound cashier shift"],
  ["shifts.close", "Close an owned cashier shift"],
  ["shifts.manage", "Hand over shifts and approve cash variance"],
  ["orders.read", "View branch orders"],
  ["orders.create", "Create shift-bound orders"],
  ["orders.write", "Change open orders and draft lines"],
  ["orders.manage", "Override controlled order conflicts"],
  ["orders.table.move", "Move active orders between dining tables"],
  ["orders.owner.transfer", "Transfer active order responsibility"],
  ["orders.split-merge", "Split and merge compatible active orders"],
  ["orders.complete", "Complete fully paid and prepared orders"],
  ["orders.send", "Send immutable order snapshots to preparation"],
  ["orders.customer-data.read", "View delivery phone and directions"],
  ["payments.read", "View branch payment records"],
  ["payments.create", "Record cash and manual external tenders"],
  ["payments.verify", "Independently verify manual non-cash tenders"],
  ["payments.manage", "Cancel unresolved payment attempts"],
  ["receipts.read", "View immutable commercial receipts"],
  ["receipts.create", "Generate receipts for completed orders"],
  ["receipts.reprint", "Queue and audit receipt reprints"],
  ["print-jobs.manage", "Advance and retry branch print jobs"],
  ["refunds.read", "View branch refund and reversal history"],
  ["refunds.request", "Request an original-tender refund"],
  ["refunds.approve", "Approve or reject another user's refund"],
  ["refunds.resolve", "Record independently verified external refund outcomes"],
  ["cash-movements.read", "View branch cash movement history"],
  ["cash-movements.request", "Request an append-only cash movement"],
  ["cash-movements.approve", "Approve or reject another user's cash movement"],
  ["reports.read", "View branch operational and financial reports"],
  ["reports.export", "Export branch reports as audited CSV files"],
  ["inventory.read", "View branch inventory configuration and stock ledger"],
  [
    "inventory.configure",
    "Configure inventory units, locations, items and recipes",
  ],
  ["inventory.write", "Post inventory counts, transfers and stock movements"],
  ["inventory.manage", "Authorize controlled inventory policy overrides"],
  [
    "procurement.read",
    "View suppliers, orders, receipts, returns and cost previews",
  ],
  ["procurement.configure", "Configure branch suppliers and supplier items"],
  ["procurement.write", "Create purchase orders and post receipts and returns"],
  [
    "procurement.manage",
    "Cancel purchase orders and authorize procurement overrides",
  ],
  ["kds.read", "View branch preparation queues"],
  ["kds.write", "Advance preparation ticket states"],
  ["kds.manage", "Approve controlled preparation exceptions"],
  ["tax.read", "View tax classifications, profiles and calculation previews"],
  ["tax.configure", "Create, schedule and activate tax configuration"],
  ["tax.approve", "Record external tax approval evidence"],
  ["sync.recovery.read", "View offline synchronization exceptions"],
  [
    "sync.recovery.manage",
    "Resolve reviewed terminal synchronization commands",
  ],
  [
    "operations.read",
    "View organization operational diagnostics and recovery evidence",
  ],
  ["operations.manage", "Record reviewed backup and restore evidence"],
  ["release.read", "View pilot and production readiness evidence"],
  ["release.manage", "Record readiness evidence and review snapshots"],
  ["customers.read", "View minimized organization customer profiles"],
  ["customers.create", "Create encrypted customer profiles"],
  [
    "customers.manage",
    "Correct, restrict and manage customer profiles and consent",
  ],
  [
    "customers.pii.read",
    "View decrypted customer contact data with an access reason",
  ],
  [
    "customer-data.export",
    "Export one customer data package with an access reason",
  ],
  ["privacy.requests.read", "View organization privacy request history"],
  ["privacy.requests.manage", "Verify and progress customer privacy requests"],
  ["privacy.policies.read", "View retention policy drafts and previews"],
  [
    "privacy.policies.manage",
    "Create and activate approved retention policies",
  ],
  ["audit.read", "View audit history"],
  ["audit.export", "Export bounded redacted audit history"],
  ["audit.integrity.read", "View and verify tamper-evident audit batches"],
  ["audit.integrity.manage", "Create tamper-evident audit batches"],
  ["security.alerts.read", "View organization security alerts"],
  [
    "security.alerts.manage",
    "Evaluate, acknowledge and resolve security alerts",
  ],
  ["security.sessions.read", "View safe organization session metadata"],
  ["security.sessions.manage", "Revoke active staff sessions"],
  ["privacy.keys.read", "View safe customer encryption key posture"],
  ["privacy.keys.manage", "Rewrap bounded customer encryption envelopes"],
  ["staff.manage", "Manage staff and role assignments"],
  ["roles.manage", "Create roles and assign permission sets"],
  ["device.manage", "Enroll, activate and revoke branch devices"],
] as const;

async function seed() {
  await prisma.organization.upsert({
    where: { id: demoOrganizationId },
    update: {},
    create: {
      id: demoOrganizationId,
      name: "DEMO — Base Cafe configuration pending owner validation",
    },
  });

  await prisma.branch.upsert({
    where: { id: demoBranchId },
    update: {},
    create: {
      id: demoBranchId,
      organizationId: demoOrganizationId,
      name: "DEMO branch — not production configuration",
    },
  });

  await prisma.device.upsert({
    where: { id: demoDeviceId },
    update: {},
    create: {
      id: demoDeviceId,
      organizationId: demoOrganizationId,
      branchId: demoBranchId,
      name: "DEMO development terminal",
      status: "ACTIVE",
      enrolledAt: new Date(),
    },
  });

  for (const [key, description] of permissions) {
    await prisma.permission.upsert({
      where: { key },
      update: { description },
      create: { key, description },
    });
  }

  await prisma.role.upsert({
    where: { id: ownerRoleId },
    update: {},
    create: {
      id: ownerRoleId,
      organizationId: demoOrganizationId,
      name: "DEMO owner",
      scope: RoleScope.ORGANIZATION,
      isSystem: true,
      permissions: {
        create: permissions.map(([permissionKey]) => ({ permissionKey })),
      },
    },
  });

  for (const [permissionKey] of permissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionKey: { roleId: ownerRoleId, permissionKey } },
      update: {},
      create: { roleId: ownerRoleId, permissionKey },
    });
  }
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password) {
    console.info(
      `Seeded demo organization, branch and device ${demoDeviceId}. No admin was created because bootstrap credentials are empty.`,
    );
    return;
  }

  if (password.length < 12) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.");
  }

  const passwordHash = await hash(password, {
    algorithm: 2,
    memoryCost: 65_536,
    timeCost: 3,
    parallelism: 1,
    outputLen: 32,
  });

  const user = await prisma.user.upsert({
    where: {
      organizationId_email: {
        organizationId: demoOrganizationId,
        email,
      },
    },
    update: { passwordHash, mustChangePassword: false },
    create: {
      organizationId: demoOrganizationId,
      email,
      displayName: "Development administrator",
      passwordHash,
      mustChangePassword: false,
    },
  });

  const existingAssignment = await prisma.userRole.findFirst({
    where: { userId: user.id, roleId: ownerRoleId, branchId: null },
  });

  if (!existingAssignment) {
    await prisma.userRole.create({
      data: { userId: user.id, roleId: ownerRoleId },
    });
  }

  console.info(`Seeded development administrator ${email}.`);
}

seed()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
