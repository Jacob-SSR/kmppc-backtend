// Utility สำหรับ sync แท็กของ Article/Discussion —
// upsert Tag ตามชื่อ แล้วแทนที่แถว junction ทั้งหมด (ลบของเก่า สร้างของใหม่)
// export ไว้ให้ module อื่น (article/discussion) เรียกใช้ภายหลัง

import { PrismaService } from '../prisma/prisma.service';

async function upsertTagsByName(prisma: PrismaService, tagNames: string[]) {
  const names = [
    ...new Set(tagNames.map((n) => n.trim()).filter((n) => n.length > 0)),
  ];
  const tags = await Promise.all(
    names.map((tag_name) =>
      prisma.tag.upsert({
        where: { tag_name },
        update: {},
        create: { tag_name },
      }),
    ),
  );
  return tags;
}

export async function syncArticleTags(
  prisma: PrismaService,
  articleId: string,
  tagNames: string[],
) {
  const tags = await upsertTagsByName(prisma, tagNames);
  await prisma.$transaction([
    prisma.articleTag.deleteMany({ where: { article_id: articleId } }),
    prisma.articleTag.createMany({
      data: tags.map((t) => ({ article_id: articleId, tag_id: t.id })),
    }),
  ]);
  return tags;
}

export async function syncDiscussionTags(
  prisma: PrismaService,
  discussionId: string,
  tagNames: string[],
) {
  const tags = await upsertTagsByName(prisma, tagNames);
  await prisma.$transaction([
    prisma.discussionTag.deleteMany({
      where: { discussion_id: discussionId },
    }),
    prisma.discussionTag.createMany({
      data: tags.map((t) => ({ discussion_id: discussionId, tag_id: t.id })),
    }),
  ]);
  return tags;
}
