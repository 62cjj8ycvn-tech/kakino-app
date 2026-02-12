export type Budget = {
id: string;
categoryId: string;
subCategoryId?: string;
month: string; // YYYY-MM
amount: number;
createdAt: Date;
updatedAt: Date;
};
