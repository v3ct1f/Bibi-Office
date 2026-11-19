export type MovementKind = "receipt" | "issue" | "adjustment" | "transfer_out" | "transfer_in" | "count";
export interface Item {
  id: string; sku: string; name: string; description: string | null; category: string | null; unit: string; barcode: string | null;
  cost: number; price: number | null; reorderPoint: number | null; reorderQty: number | null; archived: boolean;
  onHand: number; low: boolean; value: number;
}
export interface ItemDetail extends Item { currency: string; stock: { locationId: string; location: string; quantity: number }[] }
export interface ItemList { currency: string; categories: string[]; data: Item[]; nextCursor: string | null }
export interface Location { id: string; name: string; archived: boolean; position: number; itemsInStock: number }
export interface Movement {
  id: string; itemId: string; locationId: string; kind: MovementKind; quantity: number; unitCost: number | null; groupId: string;
  reference: string | null; note: string | null; createdAt: string; sku: string; itemName: string; unit: string; location: string; by: string;
}
export interface ReorderRow { id: string; sku: string; name: string; unit: string; onHand: number; reorderPoint: number; suggestedQty: number; estCost: number }
export interface Summary { currency: string; items: number; stockValue: number; lowCount: number; low: ReorderRow[] }
