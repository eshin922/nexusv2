// Quote Workflow A.1 v2 — ASY/LEAF model with library reuse
// 36 scenarios across 8 groups. PP + SP as worked examples;
// Soft goods + Tertiary packaging as placeholders ("fields TBD");
// 4 other types in taxonomy but not surfaced as scenarios.

window.NXA1V2 = {
  me: {
    name: "Maya Okafor",
    initials: "MO",
    can_edit_specs: true,
    can_create_leaves: true,
  },

  project: {
    client: "Lumen & Co.",
    deal_name: "Q3 Replenish + Glow Capsule Launch",
    scenario: "Primary",
    version: 4,
  },

  policy: {
    target_margin_pct: 0.35,
    floor_margin_pct: 0.25,
  },

  // ─── Product Type taxonomy (single table with scope flag) ────────
  product_types: {
    // ASY-scope types — categorization only, no spec rendering
    asy_skincare:    { id: "asy_skincare",   name: "Skincare",   scope: "assembly", field_schema: null },
    asy_supplement:  { id: "asy_supplement", name: "Supplement", scope: "assembly", field_schema: null },
    asy_body:        { id: "asy_body",       name: "Body care",  scope: "assembly", field_schema: null },

    // LEAF-scope types — drive spec rendering
    leaf_pp: {
      id: "leaf_pp", name: "Primary packaging", scope: "leaf",
      field_schema: [
        { key: "pp_description",        label: "Description",        wide: true },
        { key: "pp_component_type",     label: "Component type" },
        { key: "pp_quantities",         label: "Quantities" },
        { key: "pp_size",               label: "Size" },
        { key: "pp_material",           label: "Material" },
        { key: "pp_deco",               label: "Deco" },
        { key: "pp_additional_details", label: "Additional details", wide: true },
        { key: "pp_factory_1",          label: "Factory 1" },
        { key: "pp_factory_2",          label: "Factory 2" },
        { key: "pp_packout_details",    label: "Packout details",    wide: true },
      ],
    },
    leaf_sp: {
      id: "leaf_sp", name: "Secondary packaging", scope: "leaf",
      field_schema: [
        { key: "sp_description",        label: "Description",        wide: true },
        { key: "sp_material",           label: "Material" },
        { key: "sp_size",               label: "Size" },
        { key: "sp_color",              label: "Color" },
        { key: "sp_coating",            label: "Coating" },
        { key: "sp_finishing",          label: "Finishing" },
        { key: "sp_quantities",         label: "Quantities" },
        { key: "sp_additional_details", label: "Additional details", wide: true },
        { key: "sp_factory_1",          label: "Factory 1" },
        { key: "sp_factory_2",          label: "Factory 2" },
        { key: "sp_packout_details",    label: "Packout details",    wide: true },
      ],
    },
    // Placeholders — Edward provides field lists iteratively
    leaf_soft:       { id: "leaf_soft",       name: "Soft goods",            scope: "leaf", field_schema: null, placeholder: true },
    leaf_tertiary:   { id: "leaf_tertiary",   name: "Tertiary packaging",    scope: "leaf", field_schema: null, placeholder: true },
    leaf_component:  { id: "leaf_component",  name: "Component / part",      scope: "leaf", field_schema: null, placeholder: true, hidden: true },
    leaf_subassy:    { id: "leaf_subassy",    name: "Assembly sub-component", scope: "leaf", field_schema: null, placeholder: true, hidden: true },
    leaf_service:    { id: "leaf_service",    name: "Service / labor",       scope: "leaf", field_schema: null, placeholder: true, hidden: true },
    leaf_other:      { id: "leaf_other",      name: "Other",                  scope: "leaf", field_schema: null, placeholder: true, hidden: true },
  },

  // ─── Library leaves (globally reusable) ──────────────────────────
  // Each leaf has: identity + product_type_id + spec_values + version + refs
  leaves: {
    // Complete PP leaf — referenced by 2 ASYs across 2 scenarios
    leaf_glass_dropper_30: {
      id: "leaf_glass_dropper_30",
      name: "30ml Glass Dropper Bottle · Type III soda-lime · matte black",
      sku: "VP-2104-30",
      product_type_id: "leaf_pp",
      url: "https://verrepacific.com/sku/vp-2104-30",
      image_url: null,
      unit_cost: 0.84,
      fsc_claim: false, fsc_status: "n/a", supplier_verified: true,
      archived: false,
      current_version: 4,
      spec_completeness: "complete",
      spec_values: {
        pp_description: "Glass dropper bottle, matte black exterior, frosted finish",
        pp_component_type: "Primary container",
        pp_quantities: "30ml fill volume",
        pp_size: "2.047\" × 4.488\" (52mm × 114mm)",
        pp_material: "Type III soda-lime glass",
        pp_deco: "Matte black powder coat + silver foil hot stamp",
        pp_additional_details: "Tamper-evident shrink band at neck",
        pp_factory_1: "Verre Pacific (Shenzhen) — VP-2104",
        pp_factory_2: "Glasgow Pacific (Yantian) — backup tooling",
        pp_packout_details: "12-cell paperboard partition · 144 units/case",
      },
      references: [
        { scenario: "Primary", assembly: "GLW-30 · Hydra-Glow 30ml" },
        { scenario: "Q3 reorder · Beija Flor", assembly: "BF-30 · Bloom Serum 30ml" },
      ],
    },
    // Complete SP leaf — referenced by 3 ASYs across 2 scenarios
    leaf_folding_carton_glw: {
      id: "leaf_folding_carton_glw",
      name: "Folding carton · 350gsm SBS · matte black + spot UV",
      sku: "PW-880-A",
      product_type_id: "leaf_sp",
      unit_cost: 0.32,
      fsc_claim: true, fsc_status: "FSC-Mix", supplier_verified: true,
      archived: false,
      current_version: 3,
      spec_completeness: "complete",
      spec_values: {
        sp_description: "Folding carton, matte black with spot UV on logo + product name",
        sp_material: "350gsm SBS paperboard, FSC certified",
        sp_size: "55mm × 55mm × 120mm",
        sp_color: "Pantone Black 6 C, matte lamination",
        sp_coating: "Spot UV on logo + product name",
        sp_finishing: "Soft-touch lamination + spot UV",
        sp_quantities: "1 unit per carton",
        sp_additional_details: "Recyclable per Resin Code 21 (paperboard)",
        sp_factory_1: "PrintWorks Co. (Shanghai) — PW-880",
        sp_factory_2: "",
        sp_packout_details: "144 cartons/master case, 12 master/pallet",
      },
      references: [
        { scenario: "Primary", assembly: "GLW-30 · Hydra-Glow 30ml" },
        { scenario: "Primary", assembly: "GLW-50 · Hydra-Glow 50ml" },
        { scenario: "Q3 reorder · Beija Flor", assembly: "BF-30 · Bloom Serum 30ml" },
      ],
    },
    // Partial SP leaf
    leaf_folding_carton_50: {
      id: "leaf_folding_carton_50",
      name: "Folding carton · 350gsm SBS · 50ml variant",
      sku: "PW-880-B",
      product_type_id: "leaf_sp",
      unit_cost: 0.38,
      fsc_claim: true, fsc_status: "FSC-Mix", supplier_verified: false,
      archived: false,
      current_version: 1,
      spec_completeness: "partial",
      spec_values: {
        sp_description: "Folding carton, matte black",
        sp_material: "350gsm SBS paperboard",
        sp_size: "",
        sp_color: "",
        sp_coating: "",
        sp_finishing: "",
        sp_quantities: "1 unit per carton",
        sp_additional_details: "",
        sp_factory_1: "",
        sp_factory_2: "",
        sp_packout_details: "",
      },
      references: [
        { scenario: "Primary", assembly: "GLW-50 · Hydra-Glow 50ml" },
      ],
    },
    // Soft-goods leaf — placeholder type (fields TBD)
    leaf_label_glw: {
      id: "leaf_label_glw",
      name: "GLW front + back label · matte stock",
      sku: "PW-881",
      product_type_id: "leaf_soft",
      unit_cost: 0.18,
      fsc_claim: false, fsc_status: "n/a", supplier_verified: true,
      archived: false,
      current_version: 1,
      spec_completeness: "partial", // placeholder rendering decides actual state
      spec_values: {},
      references: [
        { scenario: "Primary", assembly: "GLW-30 · Hydra-Glow 30ml" },
      ],
    },
    // Tertiary-packaging leaf — placeholder
    leaf_master_carton: {
      id: "leaf_master_carton",
      name: "Master carton · 144-unit shipper",
      sku: "PW-MC-144",
      product_type_id: "leaf_tertiary",
      unit_cost: 0.12,
      fsc_claim: false, fsc_status: "n/a", supplier_verified: true,
      archived: false,
      current_version: 1,
      spec_completeness: "empty",
      spec_values: {},
      references: [
        { scenario: "Primary", assembly: "GLW-30 · Hydra-Glow 30ml" },
        { scenario: "Primary", assembly: "GLW-50 · Hydra-Glow 50ml" },
      ],
    },
    // No-type leaf — surfaces type-picker on Edit specs
    leaf_unset: {
      id: "leaf_unset",
      name: "Tamper-evident shrink band",
      sku: "VP-9012",
      product_type_id: null,
      unit_cost: 0.04,
      archived: false,
      current_version: 0,
      spec_completeness: "no_type",
      spec_values: {},
      references: [
        { scenario: "Primary", assembly: "GLW-30 · Hydra-Glow 30ml" },
      ],
    },
    // HDPE bottle for RPL-200 — complete PP leaf
    leaf_hdpe_200: {
      id: "leaf_hdpe_200",
      name: "200ml HDPE Pump Bottle · semi-translucent natural",
      sku: "PP-501-200",
      product_type_id: "leaf_pp",
      unit_cost: 0.62,
      fsc_claim: false, fsc_status: "n/a", supplier_verified: true,
      archived: false,
      current_version: 2,
      spec_completeness: "complete",
      spec_values: {
        pp_description: "HDPE pump bottle, semi-translucent natural",
        pp_component_type: "Primary container",
        pp_quantities: "200ml fill volume",
        pp_size: "55mm × 55mm × 175mm",
        pp_material: "HDPE Grade 2",
        pp_deco: "Silkscreen 2-color front + back",
        pp_additional_details: "Pump head with locking actuator",
        pp_factory_1: "Pacific Plastics (Dongguan) — PP-501",
        pp_factory_2: "",
        pp_packout_details: "24 units/case, foam tray dividers",
      },
      references: [{ scenario: "Primary", assembly: "RPL-200 · Replenish 200ml" }],
    },
    // PET bottle for CAP-60 — empty (no specs entered yet)
    leaf_pet_60: {
      id: "leaf_pet_60",
      name: "60ct PET Bottle · CR cap",
      sku: "PP-PET-60",
      product_type_id: "leaf_pp",
      unit_cost: 0.42,
      archived: false,
      current_version: 0,
      spec_completeness: "empty",
      spec_values: {},
      references: [{ scenario: "Primary", assembly: "CAP-60 · Glow Capsule" }],
    },
  },

  // ─── ASYs (per-scenario) — the quote's cost-stack tree ───────────
  assemblies: [
    {
      id: "asy_glw30", sku: "GLW-30", name: "Hydra-Glow Vitamin C Serum 30ml",
      product_type_id: "asy_skincare",
      pack_label: "30ml glass dropper, screw cap",
      unit_price: 4.45, margin_pct: 0.388, markup_pct: 0.30,
      leaves: [
        // leaf_id, qty, position
        { leaf_id: "leaf_glass_dropper_30", qty: 1, position: 1 },
        { leaf_id: "leaf_folding_carton_glw", qty: 1, position: 2 },
        { leaf_id: "leaf_label_glw", qty: 1, position: 3 },
        { leaf_id: "leaf_unset", qty: 1, position: 4 },
        { leaf_id: "leaf_master_carton", qty: 1/144, position: 5 },
      ],
    },
    {
      id: "asy_glw50", sku: "GLW-50", name: "Hydra-Glow Vitamin C Serum 50ml",
      product_type_id: "asy_skincare",
      pack_label: "50ml glass dropper, screw cap",
      unit_price: 6.10, margin_pct: 0.402, markup_pct: 0.30,
      leaves: [
        { leaf_id: "leaf_folding_carton_glw", qty: 1, position: 1 },
        { leaf_id: "leaf_folding_carton_50", qty: 1, position: 2 },
        { leaf_id: "leaf_master_carton", qty: 1/144, position: 3 },
      ],
    },
    {
      id: "asy_rpl200", sku: "RPL-200", name: "Replenish Body Lotion 200ml",
      product_type_id: "asy_body",
      pack_label: "200ml HDPE pump bottle",
      unit_price: 4.65, margin_pct: 0.401, markup_pct: 0.30,
      leaves: [
        { leaf_id: "leaf_hdpe_200", qty: 1, position: 1 },
      ],
    },
    {
      id: "asy_cap60", sku: "CAP-60", name: "Glow Capsule Daily Inner Beauty",
      product_type_id: "asy_supplement",
      pack_label: "60ct PET bottle, child-resistant cap",
      unit_price: 7.55, margin_pct: 0.412, markup_pct: 0.30,
      leaves: [
        { leaf_id: "leaf_pet_60", qty: 1, position: 1 },
      ],
    },
  ],

  // Tier carry-forward from Phase A for PDF preview
  tiers: [
    { id: "T1", units: 5000,  recommended: false },
    { id: "T2", units: 10000, recommended: true },
    { id: "T3", units: 25000, recommended: false },
    { id: "T4", units: 50000, recommended: false },
  ],

  // ─── Library browse fixtures (cross-scenario) ────────────────────
  library_browse: [
    { leaf_id: "leaf_glass_dropper_30", refs: 2, scenarios: 2 },
    { leaf_id: "leaf_folding_carton_glw", refs: 3, scenarios: 2 },
    { leaf_id: "leaf_folding_carton_50", refs: 1, scenarios: 1 },
    { leaf_id: "leaf_label_glw", refs: 1, scenarios: 1 },
    { leaf_id: "leaf_master_carton", refs: 2, scenarios: 1 },
    { leaf_id: "leaf_hdpe_200", refs: 1, scenarios: 1 },
    { leaf_id: "leaf_pet_60", refs: 1, scenarios: 1 },
    // Additional library items not in current scenario (for browse demo)
    { leaf_id: "leaf_glass_dropper_50", refs: 1, scenarios: 1,
      _virtual: { name: "50ml Glass Dropper · Type III soda-lime", sku: "VP-2104-50", type: "Primary packaging" } },
    { leaf_id: "leaf_carton_50ml_bf", refs: 2, scenarios: 1,
      _virtual: { name: "50ml Folding carton · Beija Flor variant", sku: "PW-882", type: "Secondary packaging" } },
  ],

  // Version history sample
  leaf_glass_dropper_history: [
    { v: 4, ts: "2026-05-15 09:14", actor: "Maya Okafor",
      action: "Updated Factory 2 backup tooling reference",
      diff: { pp_factory_2: { from: "", to: "Glasgow Pacific (Yantian) — backup tooling" } },
      pinned_by_quotes: ["DPS-2418"] },
    { v: 3, ts: "2026-04-22 14:30", actor: "Maya Okafor",
      action: "Updated PP deco · added silver foil hot stamp",
      diff: { pp_deco: { from: "Matte black powder coat", to: "Matte black powder coat + silver foil hot stamp" } },
      pinned_by_quotes: ["DPS-2390"] },
    { v: 2, ts: "2026-03-10 11:05", actor: "Tomás Beck",
      action: "Updated PP material · matte → matte black powder coat",
      diff: { pp_material: { from: "Type III soda-lime", to: "Type III soda-lime glass" } },
      pinned_by_quotes: ["DPS-2342", "BF-2390"] },
    { v: 1, ts: "2026-02-28 08:42", actor: "Maya Okafor",
      action: "Created leaf · initial spec",
      diff: null,
      pinned_by_quotes: ["DPS-2299"] },
  ],

  // Quote-scoped pinning for replenishment scenarios
  prior_quote_ref: "QU-2024-0142",
  prior_quote_pins: {
    leaf_glass_dropper_30: 4,  // unchanged since v4
    leaf_folding_carton_glw: 2,  // changed since (now v3)
  },

  // CSV preview rows for audit export
  audit_log_sample: [
    { ts: "2026-05-17 14:32:00", actor_type: "user", actor_name: "Maya Okafor",
      action: "leaf_spec_field_edit",
      target_type: "leaf_spec", target_id: "leaf_glass_dropper_30:v4",
      diff: '{"pp_factory_2":{"from":null,"to":"Glasgow Pacific (Yantian) — backup tooling"}}',
      audit_id: "a_4104", caused_by: null },
    { ts: "2026-05-17 14:31:55", actor_type: "system", actor_name: "system",
      action: "leaf_spec_version_pin",
      target_type: "quote_leaf", target_id: "DPS-2418:leaf_glass_dropper_30",
      diff: '{"version_pinned":{"from":null,"to":4}}',
      audit_id: "a_4103", caused_by: "a_4104" },
    { ts: "2026-05-17 12:08:42", actor_type: "user", actor_name: "Tomás Beck",
      action: "leaf_create",
      target_type: "leaf", target_id: "leaf_pet_60",
      diff: '{"name":{"to":"60ct PET Bottle · CR cap"},"product_type_id":{"to":"leaf_pp"}}',
      audit_id: "a_4087", caused_by: null },
    { ts: "2026-05-16 18:14:00", actor_type: "user", actor_name: "Maya Okafor",
      action: "assembly_leaf_attach",
      target_type: "assembly_leaf", target_id: "asy_glw30:leaf_master_carton",
      diff: '{"quantity":{"from":null,"to":0.007},"position":{"from":null,"to":5}}',
      audit_id: "a_4071", caused_by: null },
  ],

  // ─── 36 scenarios across 8 groups ────────────────────────────────
  scenarios: {
    // GROUP A — ASY tree + leaf context menu (4 scenarios)
    a01_tree: {
      group: "A · ASY tree",
      surface: "tree",
      label: "① SKUs page · ASY tree with nested leaves",
      description: "Cost-stack tree. ASYs as parent rows with per-leaf children. Completeness chips at both levels.",
    },
    a02_leaf_context: {
      group: "A · ASY tree",
      surface: "tree",
      label: "② Leaf context menu · Edit specs option",
      description: "Existing menu (Move up / down / Delete cascade / Assign to parent) gains Edit specs.",
      open_context: "leaf_glass_dropper_30",
    },
    a03_asy_context: {
      group: "A · ASY tree",
      surface: "tree",
      label: "③ ASY context menu · no Edit specs",
      description: "ASY menu has Edit product / Duplicate / Delete — explicitly NOT Edit specs.",
      open_context: "asy_glw30",
    },
    a04_rollup: {
      group: "A · ASY tree",
      surface: "tree",
      label: "④ ASY rollup completeness states",
      description: "All complete · partial · no leaves · mixed — shown on each ASY row.",
      highlight: "rollup",
    },

    // GROUP B — Type-aware spec entry per leaf (6 scenarios)
    b05_pp_complete: {
      group: "B · Spec entry",
      surface: "spec_entry",
      label: "⑤ Primary packaging leaf · complete",
      leaf_id: "leaf_glass_dropper_30",
    },
    b06_sp_partial: {
      group: "B · Spec entry",
      surface: "spec_entry",
      label: "⑥ Secondary packaging leaf · partial",
      leaf_id: "leaf_folding_carton_50",
    },
    b07_soft_placeholder: {
      group: "B · Spec entry",
      surface: "spec_entry",
      label: "⑦ Soft goods leaf · placeholder treatment",
      leaf_id: "leaf_label_glw",
    },
    b08_tertiary_placeholder: {
      group: "B · Spec entry",
      surface: "spec_entry",
      label: "⑧ Tertiary packaging leaf · placeholder",
      leaf_id: "leaf_master_carton",
    },
    b09_no_type: {
      group: "B · Spec entry",
      surface: "spec_entry",
      label: "⑨ Leaf without Product Type · type-picker",
      leaf_id: "leaf_unset",
    },
    b10_rls_readonly: {
      group: "B · Spec entry",
      surface: "spec_entry",
      label: "⑩ Unauthorized user · RLS read-only",
      leaf_id: "leaf_glass_dropper_30",
      readonly: true,
    },

    // GROUP C — Add Product modal ASY/LEAF toggle (6 scenarios)
    c11_asy_mode: {
      group: "C · Add Product modal",
      surface: "add_modal",
      label: "⑪ Modal · ASY mode · commercial fields",
      mode: "asy",
    },
    c12_leaf_no_type: {
      group: "C · Add Product modal",
      surface: "add_modal",
      label: "⑫ Modal · LEAF mode · no type selected",
      mode: "leaf", leaf_type: null,
    },
    c13_leaf_pp_selected: {
      group: "C · Add Product modal",
      surface: "add_modal",
      label: "⑬ Modal · LEAF mode · PP type · Continue to specs",
      mode: "leaf", leaf_type: "leaf_pp",
    },
    c14_continue_specs: {
      group: "C · Add Product modal",
      surface: "add_modal",
      label: "⑭ Modal-closes → Edit specs surface opens",
      mode: "leaf", leaf_type: "leaf_pp", advanced: true,
    },
    c15_defer_specs: {
      group: "C · Add Product modal",
      surface: "add_modal",
      label: "⑮ Modal · LEAF mode · defer specs (empty)",
      mode: "leaf", leaf_type: "leaf_pp", defer: true,
    },
    c16_library_scope: {
      group: "C · Add Product modal",
      surface: "add_modal",
      label: "⑯ Modal · library-scope copy + post-creation toast",
      mode: "leaf", leaf_type: "leaf_pp", show_scope_copy: true,
    },

    // GROUP D — Library + replenishment (6 scenarios)
    d17_add_existing: {
      group: "D · Library + replenishment",
      surface: "library",
      label: "⑰ Add existing library leaf to ASY",
      action: "browse",
    },
    d18_search: {
      group: "D · Library + replenishment",
      surface: "library",
      label: "⑱ Library search · by name / SKU / type / factory",
      action: "search",
    },
    d19_ref_count: {
      group: "D · Library + replenishment",
      surface: "library",
      label: "⑲ Leaf header · reference count",
      action: "refs", leaf_id: "leaf_folding_carton_glw",
    },
    d20_cascade_warning: {
      group: "D · Library + replenishment",
      surface: "library",
      label: "⑳ Edit widely-referenced leaf · cascade warning",
      action: "cascade", leaf_id: "leaf_folding_carton_glw",
    },
    d21_replenishment_unchanged: {
      group: "D · Library + replenishment",
      surface: "library",
      label: "㉑ Replenishment · leaf unchanged since prior quote",
      action: "replenishment_unchanged",
    },
    d22_replenishment_changed: {
      group: "D · Library + replenishment",
      surface: "library",
      label: "㉒ Replenishment · leaf changed since prior quote",
      action: "replenishment_changed",
    },

    // GROUP E — PDF addendum per-leaf grouped by ASY (6 scenarios)
    e23_addendum_off: {
      group: "E · PDF addendum",
      surface: "addendum",
      label: "㉓ Addendum OFF · single-page pricing",
      addendum: false,
    },
    e24_per_leaf_blocks: {
      group: "E · PDF addendum",
      surface: "addendum",
      label: "㉔ Addendum ON · per-leaf blocks under ASY",
      addendum: true,
    },
    e25_mixed_types: {
      group: "E · PDF addendum",
      surface: "addendum",
      label: "㉕ Addendum · mixed leaf types in one ASY",
      addendum: true, focus_asy: "asy_glw30",
    },
    e26_partial_dashes: {
      group: "E · PDF addendum",
      surface: "addendum",
      label: "㉖ Addendum · partial specs render as --",
      addendum: true, focus_asy: "asy_glw50",
    },
    e27_zero_specs: {
      group: "E · PDF addendum",
      surface: "addendum",
      label: "㉗ Addendum toggled ON · zero spec data · suppress",
      addendum: true, all_empty: true,
    },
    e28_toggle_ui: {
      group: "E · PDF addendum",
      surface: "addendum",
      label: "㉘ Toggle UI · renders N leaves across M ASYs",
      addendum: true, show_toggle: true,
    },

    // GROUP F — Re-quote workflow (4 scenarios)
    f29_spec_edit_warning: {
      group: "F · Re-quote",
      surface: "requote",
      label: "㉙ Spec edit on leaf in active quotes · cascade warning",
      mode: "edit_warning",
    },
    f30_out_of_sync: {
      group: "F · Re-quote",
      surface: "requote",
      label: "㉚ Out-of-sync indicator on sent quote",
      mode: "out_of_sync",
    },
    f31_requote_init: {
      group: "F · Re-quote",
      surface: "requote",
      label: "㉛ Re-quote initiated · duplicate with current versions",
      mode: "requote_init",
    },
    f32_superseded: {
      group: "F · Re-quote",
      surface: "requote",
      label: "㉜ Superseded quote · banner + new-qid link",
      mode: "superseded",
    },

    // GROUP G — Audit log export (3 scenarios)
    g33_per_quote_export: {
      group: "G · Audit export",
      surface: "export",
      label: "㉝ Per-quote export modal · CSV scope",
      mode: "quote",
    },
    g34_per_leaf_export: {
      group: "G · Audit export",
      surface: "export",
      label: "㉞ Per-leaf export modal · library audit",
      mode: "leaf",
    },
    g35_csv_preview: {
      group: "G · Audit export",
      surface: "export",
      label: "㉟ CSV preview · field-level events + caused_by",
      mode: "csv",
    },

    // GROUP H — Soft gate (1 scenario)
    h36_soft_gate: {
      group: "H · Soft gate",
      surface: "soft_gate",
      label: "㊱ Preview Quote · incomplete leaf specs · soft gate",
    },
  },
};
