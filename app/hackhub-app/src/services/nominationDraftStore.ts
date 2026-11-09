export interface NominationDraftScope {
  userId: string
  hackathonId: string
  nominationType: 'individual' | 'team'
  editId?: string | null
}

export interface NominationDraft<T> {
  version: 1
  savedAt: string
  data: T
}

// 使用独立的用户、活动、类型及编辑记录键，防止恢复其他表单的草稿。
export const nominationDraftKey = (scope: NominationDraftScope) => JSON.stringify([
  scope.userId, scope.hackathonId, scope.nominationType, scope.editId ?? 'new',
])

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  if (typeof indexedDB === 'undefined') {
    reject(new Error('Draft storage is unavailable in this browser.'))
    return
  }
  let settled = false
  const request = indexedDB.open('hackhub-nomination-drafts', 1)
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains('drafts')) request.result.createObjectStore('drafts')
  }
  request.onsuccess = () => {
    if (settled) { request.result.close(); return }
    settled = true
    request.result.onversionchange = () => request.result.close()
    resolve(request.result)
  }
  request.onerror = () => { settled = true; reject(new Error('Unable to open draft storage.')) }
  request.onblocked = () => { settled = true; reject(new Error('Close other nomination tabs and retry draft storage.')) }
})

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction('drafts', mode)
      let result: T
      const request = action(transaction.objectStore('drafts'))
      request.onsuccess = () => { result = request.result }
      // 只有事务提交完成才提示保存成功，容量不足或事务回滚不能被当作已保存。
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(new Error('Unable to access draft storage. Check available browser storage and retry.'))
      transaction.onabort = () => reject(new Error('Draft storage was interrupted. Please retry.'))
    })
  } finally {
    database.close()
  }
}

export const NominationDraftStore = {
  async load<T>(key: string): Promise<NominationDraft<T> | null> {
    const record = await transact<NominationDraft<T> | undefined>('readonly', (store) => store.get(key))
    if (!record) return null
    if (record.version !== 1 || typeof record.savedAt !== 'string' || !record.data) {
      throw new Error('This draft cannot be restored. Please save a new draft.')
    }
    return record
  },
  async save<T>(key: string, data: T): Promise<NominationDraft<T>> {
    const record: NominationDraft<T> = { version: 1, savedAt: new Date().toISOString(), data }
    // IndexedDB 的结构化克隆保存文件本体，退出页面后仍可恢复照片和附件。
    await transact('readwrite', (store) => store.put(record, key))
    return record
  },
  async remove(key: string): Promise<void> {
    await transact('readwrite', (store) => store.delete(key))
  },
}
