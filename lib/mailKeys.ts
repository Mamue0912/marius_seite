export function messageContentKey(account: string, path: string, uid: number, images: boolean) {
 return JSON.stringify([account, path, uid, images]);
}
export function applyMessagePatch<T extends {id:string}>(rows:T[], id:string, patch:Partial<T>) {
 return rows.map(row=>row.id===id?{...row,...patch}:row);
}
