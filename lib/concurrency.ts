export async function mapLimit<T,R>(items:T[], limit:number, run:(item:T,index:number)=>Promise<R>):Promise<R[]> {
 if(!Number.isInteger(limit)||limit<1) throw new Error("Invalid concurrency");
 let cursor=0; const results:R[]=new Array(items.length);
 await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const index=cursor++;results[index]=await run(items[index],index);}}));
 return results;
}
