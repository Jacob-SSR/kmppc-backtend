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
  // ย้ายผู้ใช้/เอกสารจากแผนกชุดเก่า (หน่วยงานย่อย + legacy) → กลุ่มงานใหม่
  // idempotent: แผนกเก่าที่ย้ายหมดแล้วจะถูกลบในขั้นถัดไป รันซ้ำก็ไม่ทำอะไรเพิ่ม
  const DEPT_MIGRATION: Record<string, string> = {
    // legacy ชุดแรกสุด
    IT: 'DIG',
    HR: 'GEN',
    XRAY: 'XRA',
    PHAR: 'PHC',
    // หน่วยงานย่อยชุดก่อน → กลุ่มงาน
    ER: 'NSO',
    ANS: 'NSO',
    LR: 'NSO',
    KID: 'NSO',
    IPD: 'NSO',
    IPD2: 'NSO',
    IPD3: 'NSO',
    OPD: 'NSO',
    CSU: 'NSO',
    CSG: 'PSY',
    MNU: 'NUT',
    MAN: 'GEN',
    MON: 'GEN',
    ART: 'GEN',
    BOO: 'GEN',
    CAL: 'GEN',
    AMB: 'GEN',
    GAR: 'GEN',
    CLC: 'GEN',
    SEC: 'GEN',
    CLE: 'GEN',
    ACC: 'GEN',
    HRM: 'GEN',
    LAB: 'MTC',
    PLA: 'INS',
    COM: 'DIG',
    HAC: 'INS',
    MRD: 'INS',
    FMC: 'PRI',
    PHA: 'PHC',
    RHD: 'RHB',
    FUN: 'DEN',
    HED: 'PRI',
    PO: 'DOC',
    NCD: 'MED',
    STR: 'MOV',
  };
  for (const [oldCode, newCode] of Object.entries(DEPT_MIGRATION)) {
    const oldDept = await prisma.department.findUnique({
      where: { dept_code: oldCode },
    });
    if (!oldDept) continue;
    const newDept = await prisma.department.findUniqueOrThrow({
      where: { dept_code: newCode },
    });
    await prisma.user.updateMany({
      where: { dept_id: oldDept.id },
      data: { dept_id: newDept.id },
    });
    await prisma.knowledgeDocument.updateMany({
      where: { dept_id: oldDept.id },
      data: { dept_id: newDept.id },
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
    // อีเมลกลางของระบบ — รันซ้ำจะแก้อีเมล admin เดิมให้ตรงด้วย
    update: { email: 'kmppch@gmail.com' },
    create: {
      role_id: adminRole.id,
      dept_id: it.id,
      employee_no: '000001',
      username: 'admin',
      password_hash: passwordHash,
      fname: 'ผู้ดูแล',
      lname: 'ระบบ',
      email: 'kmppch@gmail.com',
      position: 'นักวิชาการคอมพิวเตอร์',
    },
  });

  // ห้องแชทต้อนรับจาก admin ให้สมาชิกทุกคนที่ยังไม่มี (idempotent — รันซ้ำไม่สร้างซ้ำ)
  const adminUser = await prisma.user.findUnique({
    where: { username: 'admin' },
  });
  if (adminUser) {
    const welcomeMessage = [
      'สวัสดีครับ 👋 ยินดีต้อนรับสู่ระบบจัดการความรู้ (KM) โรงพยาบาลพลับพลาชัย',
      '',
      'เริ่มต้นใช้งานได้เลย:',
      '• อ่าน/เขียนบทความความรู้ และตั้งกระทู้ถาม-ตอบ',
      '• สงสัยอะไรถาม AI Search ได้ตลอด',
      '• คู่มือการใช้งานอยู่ที่เมนู "เกี่ยวกับระบบ"',
      '',
      'ติดปัญหาการใช้งานตรงไหน ทักแชทนี้หาผู้ดูแลระบบได้เลยครับ',
    ].join('\n');
    const members = await prisma.user.findMany({
      where: { is_active: true, NOT: { id: adminUser.id } },
      select: { id: true },
    });
    for (const member of members) {
      const existing = await prisma.conversation.findFirst({
        where: {
          type: 'DIRECT',
          AND: [
            { members: { some: { user_id: adminUser.id } } },
            { members: { some: { user_id: member.id } } },
          ],
        },
        select: { id: true },
      });
      if (existing) continue;
      const conversation = await prisma.conversation.create({
        data: {
          type: 'DIRECT',
          created_by: adminUser.id,
          members: {
            create: [{ user_id: adminUser.id }, { user_id: member.id }],
          },
        },
      });
      await prisma.message.create({
        data: {
          conversation_id: conversation.id,
          sender_id: adminUser.id,
          message: welcomeMessage,
        },
      });
    }
  }

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
