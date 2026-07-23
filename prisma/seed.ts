import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Roles
  const adminRole = await prisma.role.upsert({
    where: { role_name: 'ADMIN' },
    update: {},
    create: { role_name: 'ADMIN', description: 'ผู้ดูแลระบบ' },
  });
  await prisma.role.upsert({
    where: { role_name: 'STAFF' },
    update: {},
    create: { role_name: 'STAFF', description: 'เจ้าหน้าที่' },
  });

  // Departments
  const it = await prisma.department.upsert({
    where: { dept_code: 'IT' },
    update: {},
    create: { dept_code: 'IT', dept_name: 'แผนกเทคโนโลยีสารสนเทศ' },
  });
  for (const [code, name] of [
    ['OPD', 'แผนกผู้ป่วยนอก'],
    ['LAB', 'แผนกห้องปฏิบัติการ'],
    ['XRAY', 'แผนกรังสีวิทยา'],
    ['PHAR', 'แผนกเภสัชกรรม'],
    ['HR', 'แผนกทรัพยากรบุคคล'],
  ] as const) {
    await prisma.department.upsert({
      where: { dept_code: code },
      update: {},
      create: { dept_code: code, dept_name: name },
    });
  }

  // Categories (ใช้ร่วมกัน Article/Discussion)
  for (const name of ['IT', 'Network', 'Printer', 'HOSxP', 'Lab', 'X-Ray', 'SOP']) {
    await prisma.category.upsert({
      where: { category_name: name },
      update: {},
      create: { category_name: name },
    });
  }

  // Admin user
  const passwordHash = await bcrypt.hash(
    process.env.SEED_ADMIN_PASSWORD ?? 'Admin@1234',
    10,
  );
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      role_id: adminRole.id,
      dept_id: it.id,
      employee_no: '000001',
      username: 'admin',
      password_hash: passwordHash,
      fname: 'ผู้ดูแล',
      lname: 'ระบบ',
      email: 'admin@hospsrisuk.go.th',
      position: 'System Administrator',
    },
  });

  // System settings defaults
  for (const [key, value, description] of [
    ['ALLOW_ANONYMOUS', 'true', 'อนุญาตโพสต์แบบไม่ระบุตัวตน (Discussion/Reply)'],
    ['AI_ENABLED', 'true', 'เปิดใช้งาน AI Search'],
    ['MAX_UPLOAD_SIZE_MB', '10', 'ขนาดไฟล์อัปโหลดสูงสุด (MB)'],
  ] as const) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, value, description },
    });
  }

  console.log('Seed เสร็จสมบูรณ์');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
