// KnowledgeService — CRUD เอกสารความรู้ (ADMIN เท่านั้น)
// การสกัดข้อความจากไฟล์ PDF/DOCX ไม่ทำที่นี่ — เป็นหน้าที่ของ indexing worker
// ทุกครั้งที่สร้าง/แก้ไข/ลบ จะ enqueue งานเข้า queue 'indexing'
// (worker จะ index ใหม่ หรือลบ chunk ทิ้งเองถ้าเอกสารถูกปิด/ลบ)

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ChunkSourceType, IndexStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateKnowledgeDocumentDto,
  UpdateKnowledgeDocumentDto,
} from './knowledge.dto';

const INDEXING_QUEUE = 'indexing';

@Injectable()
export class KnowledgeService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(INDEXING_QUEUE) private readonly indexingQueue: Queue,
  ) {}

  private async enqueueIndexing(documentId: string) {
    await this.indexingQueue.add(
      'index',
      { source_type: ChunkSourceType.DOCUMENT, source_id: documentId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );
  }

  async findAll() {
    const docs = await this.prisma.knowledgeDocument.findMany({
      where: { deleted_at: null },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        title: true,
        doc_type: true,
        description: true,
        file_url: true,
        index_status: true,
        indexed_at: true,
        dept_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        department: { select: { id: true, dept_name: true } },
        uploader: { select: { id: true, fname: true, lname: true } },
      },
    });
    return docs;
  }

  async create(userId: string, dto: CreateKnowledgeDocumentDto) {
    if (!dto.content?.trim() && !dto.file_url?.trim()) {
      throw new BadRequestException(
        'กรุณาใส่เนื้อหา (content) หรือแนบไฟล์ (file_url) อย่างน้อยหนึ่งอย่าง',
      );
    }
    if (dto.dept_id) {
      const dept = await this.prisma.department.findUnique({
        where: { id: dto.dept_id },
      });
      if (!dept) throw new NotFoundException('ไม่พบหน่วยงานที่ระบุ');
    }

    const doc = await this.prisma.knowledgeDocument.create({
      data: {
        title: dto.title,
        doc_type: dto.doc_type,
        description: dto.description ?? null,
        content: dto.content ?? '', // ถ้าว่าง worker จะสกัดจากไฟล์แล้วเติมกลับ
        file_url: dto.file_url ?? null,
        file_public_id: dto.file_public_id ?? null,
        dept_id: dto.dept_id ?? null,
        uploaded_by: userId,
        index_status: IndexStatus.PENDING,
      },
    });

    await this.enqueueIndexing(doc.id);
    return doc;
  }

  async update(id: string, dto: UpdateKnowledgeDocumentDto) {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id, deleted_at: null },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสารนี้');

    if (dto.dept_id) {
      const dept = await this.prisma.department.findUnique({
        where: { id: dto.dept_id },
      });
      if (!dept) throw new NotFoundException('ไม่พบหน่วยงานที่ระบุ');
    }

    // เปลี่ยนไฟล์ใหม่โดยไม่ได้ส่ง content ใหม่มา → ล้าง content เดิม
    // เพื่อให้ worker สกัดข้อความจากไฟล์ใหม่แทน
    const fileChanged =
      dto.file_url !== undefined && dto.file_url !== doc.file_url;
    const contentReset =
      fileChanged && dto.content === undefined ? { content: '' } : {};

    const updated = await this.prisma.knowledgeDocument.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.doc_type !== undefined && { doc_type: dto.doc_type }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.content !== undefined && { content: dto.content }),
        ...(dto.file_url !== undefined && { file_url: dto.file_url }),
        ...(dto.file_public_id !== undefined && {
          file_public_id: dto.file_public_id,
        }),
        ...(dto.dept_id !== undefined && { dept_id: dto.dept_id }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
        ...contentReset,
        index_status: IndexStatus.PENDING,
      },
    });

    // enqueue เสมอ — ถ้า is_active=false worker จะลบ chunk ออกจากดัชนีให้
    await this.enqueueIndexing(id);
    return updated;
  }

  async softDelete(id: string) {
    const doc = await this.prisma.knowledgeDocument.findFirst({
      where: { id, deleted_at: null },
    });
    if (!doc) throw new NotFoundException('ไม่พบเอกสารนี้');

    await this.prisma.knowledgeDocument.update({
      where: { id },
      data: { deleted_at: new Date(), is_active: false },
    });
    // worker จะเห็นว่าเอกสารถูกลบแล้ว → ลบ chunk ออกจากดัชนี (unindex)
    await this.enqueueIndexing(id);
    return { success: true };
  }
}
