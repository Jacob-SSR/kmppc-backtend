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
  // รายชื่อแผนก/ฝ่ายจริงของ รพ.พลับพลาชัย — upsert ด้วย dept_code
  // (รันซ้ำได้ปลอดภัย ชื่อจะอัปเดตตามลิสต์นี้ ผู้ใช้เดิมไม่หลุดแผนก)
  for (const [code, name] of [
    ['NSO', 'บริหารกลุ่มการพยาบาล'],
    ['ER', 'งานการพยาบาลผู้ป่วยอุบัติเหตุฉุกเฉินและนิติเวช'],
    ['ANS', 'งานวิสัญญี'],
    ['LR', 'งานการพยาบาลผู้คลอดและทารกแรกเกิด'],
    ['KID', 'งานการพยาบาลโรคไต'],
    ['IPD', 'งานการพยาบาลผู้ป่วยใน'],
    ['IPD2', 'งานการพยาบาลผู้ป่วยใน 2'],
    ['IPD3', 'งานการพยาบาลผู้ป่วยใน 3'],
    ['OPD', 'งานการพยาบาลผู้ป่วยนอก'],
    ['CSG', 'งานสุขภาพจิตและยาเสพติด'],
    ['MOV', 'งานเคลื่อนย้ายผู้ป่วย'],
    ['CSU', 'งานการพยาบาลหน่วยควบคุมการติดเชื้อและงานจ่ายกลาง'],
    ['MNU', 'งานโภชนศาสตร์'],
    ['MAN', 'ฝ่ายบริหารงานทั่วไป'],
    ['MON', 'งานการเงิน'],
    ['ART', 'งานพัสดุ'],
    ['BOO', 'งานธุรการ'],
    ['CAL', 'งานซ่อมบำรุง'],
    ['AMB', 'งานยานพาหนะ'],
    ['GAR', 'งานภูมิทัศน์'],
    ['CLC', 'งานซักฟอก'],
    ['SEC', 'งานรักษาความปลอดภัย'],
    ['CLE', 'งานทำความสะอาด'],
    ['MED', 'งานเวชปฏิบัติทั่วไป'],
    ['XRA', 'งานรังสี'],
    ['LAB', 'งานเทคนิคการแพทย์'],
    ['TTM', 'งานแพทย์แผนไทย'],
    ['PLA', 'ฝ่ายแผนงานและประเมินผล'],
    ['COM', 'งานศูนย์คอมพิวเตอร์'],
    ['HAC', 'งานศูนย์ประกันสุขภาพ'],
    ['MRD', 'งานเวชระเบียน'],
    ['FMC', 'กลุ่มงานบริการด้านปฐมภูมิฯองค์รวม'],
    ['PHA', 'ฝ่ายเภสัชกรรมชุมชน'],
    ['RHD', 'ฝ่ายเวชกรรมฟื้นฟู'],
    ['FUN', 'ฝ่ายทันตสาธารณสุข'],
    ['HED', 'งานสุขศึกษาและประชาสัมพันธ์'],
    ['PO', 'องค์กรแพทย์'],
    ['NCD', 'งานผู้ป่วยนอก คลินิก NCD'],
    ['TEC', 'กองช่าง'],
    ['ACC', 'งานการบัญชี'],
    ['HRM', 'งานการเจ้าหน้าที่'],
    ['STR', 'ศูนย์เปล'],
  ] as const) {
    await prisma.department.upsert({
      where: { dept_code: code },
      update: { dept_name: name },
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
