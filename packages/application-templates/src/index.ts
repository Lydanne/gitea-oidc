import { createTemplateCatalog } from "./catalog.js";
import { GiteaTemplateV1 } from "./giteaV1.js";
import { GiteaTemplateV2 } from "./giteaV2.js";

export * from "./catalog.js";
export * from "./giteaV1.js";
export * from "./giteaV2.js";
export * from "./jsonSnapshot.js";
export * from "./snapshotSchema.js";
export * from "./types.js";

export const applicationTemplateCatalog = createTemplateCatalog([GiteaTemplateV1, GiteaTemplateV2]);
