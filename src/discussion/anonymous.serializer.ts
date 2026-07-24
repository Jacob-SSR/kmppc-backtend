// Serializer กลางสำหรับโพสต์ pseudo-anonymous —
// DB เก็บ user_id จริงเสมอ แต่ห้ามให้ author หลุดออกไปกับ API response
// (ห้ามซ่อนแค่ฝั่ง frontend เด็ดขาด — ใช้ฟังก์ชันนี้กับทุก endpoint ที่คืน Discussion/Reply)

export interface AuthorPublic {
  id: string;
  fname: string;
  lname: string;
  display_name?: string | null;
  position: string | null;
  profile_image: string | null;
}

const ANONYMOUS_AUTHOR = {
  id: null,
  fname: 'ไม่ระบุตัวตน',
  lname: '',
  display_name: null,
  position: null,
  profile_image: null,
} as const;

export function serializeAuthored<
  T extends {
    is_anonymous: boolean;
    author_id?: string;
    user_id?: string;
    author?: AuthorPublic | null;
  },
>(item: T, viewerId?: string) {
  const ownerId = item.author_id ?? item.user_id;
  const isOwner = !!viewerId && viewerId === ownerId;
  if (!item.is_anonymous) return { ...item, is_own_anonymous: false };

  const rest = { ...item };
  delete rest.author_id;
  delete rest.user_id;
  return {
    ...rest,
    author: ANONYMOUS_AUTHOR,
    // เจ้าของเห็น badge "โพสต์ของคุณ (ไม่ระบุตัวตน)" — ไม่บอกใครคนอื่น
    is_own_anonymous: isOwner,
  };
}
