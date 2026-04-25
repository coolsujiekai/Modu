/**
 * migrateNotes/index.js
 * 一次性迁移：将现有 books 文档中的 notes 数组拆分为 notes 集合的独立文档。
 *
 * 迁移逻辑：
 * 1. 遍历所有包含 notes 字段的书籍（分页）
 * 2. 每条笔记以 _id = `${bookId}_${timestamp}` 写入 notes 集合
 * 3. 幂等：重复 _id 用 set() 覆盖，不会产生重复
 * 4. 迁移完成后移除 books 文档中的 notes/notesCount/thoughtCount/quoteCount 字段
 *
 * 调用方式：云函数直接调用（无参数）
 */
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const BATCH_SIZE = 50;
  let totalMigrated = 0;
  let totalBooks = 0;
  let totalErrors = 0;

  while (true) {
    const res = await db
      .collection('books')
      .where({
        notes: _.exists(true),
        // 只处理还有 notes 字段的文档（跳过已迁移的）
      })
      .field({ _id: true, _openid: true, bookName: true, notes: true, thoughtCount: true, quoteCount: true })
      .limit(BATCH_SIZE)
      .get();

    const books = res.data || [];
    if (books.length === 0) break;

    const tasks = [];
    for (const book of books) {
      const notes = Array.isArray(book.notes) ? book.notes : [];
      if (notes.length === 0) {
        // 空 notes 数组，直接清理字段
        tasks.push(
          db.collection('books').doc(book._id).update({
            data: {
              notes: _.remove(),
              notesCount: _.remove(),
              thoughtCount: _.remove(),
              quoteCount: _.remove()
            }
          }).catch(() => { totalErrors++; })
        );
        totalBooks++;
        continue;
      }

      // 将每条笔记写入 notes 集合
      for (const note of notes) {
        const ts = Number(note.timestamp || 0);
        if (!ts) continue;
        const noteId = `${book._id}_${ts}`;

        tasks.push(
          db.collection('notes').doc(noteId).set({
            data: {
              _openid: book._openid || '',
              bookId: book._id,
              bookName: (book.bookName || '').trim() || '未命名',
              text: String(note.text || '').trim(),
              type: note.type === 'quote' ? 'quote' : 'thought',
              timestamp: ts,
              createdAt: ts,
              updatedAt: Date.now()
            }
          }).catch((err) => {
            console.error(`[migrateNotes] failed to write note ${noteId}:`, err);
            totalErrors++;
          })
        );
        totalMigrated++;
      }

      // 迁移完成后，移除 books 文档中的冗余字段
      tasks.push(
        db.collection('books').doc(book._id).update({
          data: {
            notes: _.remove(),
            notesCount: _.remove(),
            thoughtCount: _.remove(),
            quoteCount: _.remove()
          }
        }).catch((err) => {
          console.error(`[migrateNotes] failed to cleanup book ${book._id}:`, err);
          totalErrors++;
        })
      );
      totalBooks++;
    }

    await Promise.all(tasks);
  }

  return {
    ok: true,
    stats: {
      booksProcessed: totalBooks,
      notesMigrated: totalMigrated,
      errors: totalErrors
    }
  };
};
