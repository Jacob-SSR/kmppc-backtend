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

  // ฝ่าย/แผนก (กลุ่มงาน) ตามโครงสร้างจริงของ รพ.พลับพลาชัย — upsert ด้วย dept_code
  // (รันซ้ำได้ปลอดภัย ชื่อจะอัปเดตตามลิสต์นี้ ผู้ใช้เดิมไม่หลุดแผนก)
  const DEPARTMENTS = [
    ['GEN', 'กลุ่มงานบริหารทั่วไป'],
    ['MTC', 'กลุ่มงานเทคนิคการแพทย์'],
    ['DEN', 'กลุ่มงานทันตกรรม'],
    ['PHC', 'กลุ่มงานเภสัชกรรมและคุ้มครองผู้บริโภค'],
    ['MED', 'กลุ่มงานการแพทย์'],
    ['NUT', 'กลุ่มงานโภชนศาสตร์'],
    ['XRA', 'กลุ่มงานรังสีวิทยา'],
    ['RHB', 'กลุ่มงานเวชกรรมฟื้นฟู'],
    ['PRI', 'กลุ่มงานบริการด้านปฐมภูมิและองค์รวม'],
    ['INS', 'กลุ่มงานประกันสุขภาพยุทธศาสตร์และสารสนเทศทางการแพทย์'],
    ['NSO', 'กลุ่มงานการพยาบาล'],
    ['DIR', 'กลุ่มอำนวยการ'],
    ['TTM', 'กลุ่มงานการแพทย์แผนไทยและการแพทย์ทางเลือก'],
    ['TEC', 'กองช่าง'],
    ['PSY', 'กลุ่มงานจิตเวชและยาเสพติด'],
    ['DIG', 'กลุ่มงานสุขภาพดิจิทัล'],
    ['DOC', 'แพทย์'],
    ['MOV', 'เคลื่อนย้ายผู้ป่วย'],
  ] as const;
  for (const [code, name] of DEPARTMENTS) {
    await prisma.department.upsert({
      where: { dept_code: code },
      update: { dept_name: name },
      create: { dept_code: code, dept_name: name },
    });
  }
  // ล้างแผนกชุดเก่าที่ไม่อยู่ในลิสต์ใหม่ — ลบเฉพาะแผนกที่ไม่มีผู้ใช้/เอกสารอ้างอิง
  await prisma.department.deleteMany({
    where: {
      dept_code: { notIn: DEPARTMENTS.map(([code]) => code) },
      users: { none: {} },
      knowledge_documents: { none: {} },
    },
  });
  // แผนกของ admin (กลุ่มงานสุขภาพดิจิทัล)
  const it = await prisma.department.findUniqueOrThrow({
    where: { dept_code: 'DIG' },
  });

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
