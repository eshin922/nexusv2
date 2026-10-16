/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @NScriptType UserEventScript
 *
 * UE Create PO from Sales — customscript_dps_new_po_creation_ue
 * File Cabinet: SuiteScripts/DPS/NewPOCreation/dps_new_po_creation_ue.js (file 29867)
 *
 * SANDBOX PROTOTYPE (Nexus PO-spec change, 2026-10-05). Changes from the
 * original, which is kept beside this file as
 * `dps_new_po_creation_ue.sandbox-original.js`:
 *
 *   1. LINK VALIDITY BY RECIPROCAL LINE KEYS. A Sales Order line keeps its PO
 *      link only if the PO line named by its `custcol_dps_order_line_key` exists
 *      on the linked PO AND points back to this very SO line. A copied line, a
 *      second line claiming the same PO line, or a link to a deleted PO line is
 *      cleared, so it is never mistaken for an already-ordered line.
 *   2. CREATE PATH. The post-save key read-back is scoped to the new PO and
 *      compares keys numerically; previously it searched every transaction and
 *      compared a string to a number.
 *   3. MANUAL LINK BY LINE KEY ONLY. `custbody_ali_manual_linked_po` pairs a PO
 *      line with an SO line only when one side's `custcol_dps_order_line_key`
 *      names the other side's `lineuniquekey`. The item + quantity heuristic is
 *      removed: it cannot tell two variants of one SKU apart. Lines without keys
 *      stay unlinked and are logged.
 *   4. ORDERED SPEC. Each PO line carries its SO line's `custcol_nx_ordered_spec`
 *      and a printable copy of that record's REDACTED readable text in
 *      `custcol_nx_spec_text`, at creation and on every SO save (sync).
 *      `fm_actives` is never in that text: Nexus withholds it before the record
 *      is written.
 */
define(['N/query', 'N/record', 'N/runtime'],
  (query, record, runtime) => {

    const FIELD = {
      MANUAL_LINKED_PO: 'custbody_ali_manual_linked_po',
      CREATE_POS: 'custbody_dps_create_pos',
      PO_VENDOR: 'custcol_dps_po_vendor',
      LINKED_ORDER: 'custcol_dps_linked_order',
      ORDER_LINE_KEY: 'custcol_dps_order_line_key',
      SPEC_LINK: 'custcol_nx_ordered_spec',
      SPEC_TEXT: 'custcol_nx_spec_text',
    };
    const SPEC_RECORD = 'customrecord_nx_ordered_spec';
    const SPEC_READABLE = 'custrecord_nxos_readable';
    const SPEC_TEXT_MAX = 3990; // Text Area limit is 4000; never truncate silently
    const sublistId = 'item';

    const num = v => (v === null || v === undefined || v === '' ? null : Number(v));
    const inList = keys => keys.map(k => String(Number(k))).join(',');

    /** Readable text of an ordered-spec record, or '' (never throws). */
    const specTextFor = (specId, cache) => {
      if (!specId) return '';
      const key = String(specId);
      if (cache.has(key)) return cache.get(key);
      let text = '';
      try {
        const rec = record.load({type: SPEC_RECORD, id: specId});
        text = String(rec.getValue(SPEC_READABLE) || '');
        if (text.length > SPEC_TEXT_MAX) {
          text = text.slice(0, SPEC_TEXT_MAX - 40) + '\n[specification continues in Nexus]';
        }
      } catch (e) {
        log.error('specTextFor', {specId, error: e.message || String(e)});
      }
      cache.set(key, text);
      return text;
    };

    /**
     * FIX 1 · Keep an SO line's PO link only when it is reciprocal.
     *
     * Pure over its inputs so it can be proven without NetSuite:
     *   soLines: [{line, uniqueKey, linkedOrder, orderLineKey}]
     *   poLines: [{uniqueKey, transaction, orderLineKey}]  (the PO lines named)
     * Returns the SO line indexes whose link must be cleared, with a reason.
     */
    const invalidLinks = (soLines, poLines) => {
      const poByKey = new Map(poLines.map(p => [num(p.uniqueKey), p]));
      const out = [];
      for (const s of soLines) {
        if (!s.linkedOrder) continue;
        if (!num(s.uniqueKey)) {
          out.push({line: s.line, reason: 'new_or_copied_line'});
          continue;
        }
        const p = poByKey.get(num(s.orderLineKey));
        if (!p) {
          out.push({line: s.line, reason: 'po_line_not_found'});
          continue;
        }
        if (num(p.transaction) !== num(s.linkedOrder)) {
          out.push({line: s.line, reason: 'po_line_on_other_order'});
          continue;
        }
        if (num(p.orderLineKey) !== num(s.uniqueKey)) {
          out.push({line: s.line, reason: 'po_line_points_elsewhere'});
        }
      }
      return out;
    };

    /**
     * FIX 3 · Manual link pairs by line key only. Pure.
     *   soLines: unlinked SO lines [{line, uniqueKey, orderLineKey}]
     *   poLines: PO lines [{index, uniqueKey, orderLineKey, linkedOrder}]
     * Returns [{soLine, poIndex, poUniqueKey, soUniqueKey}] — one PO line per SO
     * line at most, never guessed from item or quantity.
     */
    const manualPairs = (soLines, poLines, soId) => {
      const pairs = [];
      const usedPo = new Set();
      for (const s of soLines) {
        const sKey = num(s.uniqueKey);
        if (!sKey) continue;
        const candidates = poLines.filter(p =>
          !usedPo.has(p.index) &&
          (!p.linkedOrder || num(p.linkedOrder) === num(soId)) &&
          (num(p.orderLineKey) === sKey || num(s.orderLineKey) === num(p.uniqueKey)));
        if (candidates.length === 1) {
          usedPo.add(candidates[0].index);
          pairs.push({soLine: s.line, poIndex: candidates[0].index,
            poUniqueKey: num(candidates[0].uniqueKey), soUniqueKey: sKey});
        } else if (candidates.length > 1) {
          log.audit('manualLink.ambiguous', {soLineKey: sKey, candidates: candidates.map(c => c.uniqueKey)});
        }
      }
      return pairs;
    };

    const beforeLoad = context => {
      try {
        const {newRecord, form} = context;
        if (newRecord.type !== 'salesorder') return;

        let emptyPOLine = false;
        const linkedOrders = [];
        for (let line = 0; line < newRecord.getLineCount({sublistId}); line++) {
          const linkedOrder = newRecord.getSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line});
          if (linkedOrder) linkedOrders.push(Number(linkedOrder));
          else emptyPOLine = true;
        }
        if (!emptyPOLine) {
          const manualLinkedPOField = form.getField({id: FIELD.MANUAL_LINKED_PO});
          if (manualLinkedPOField) manualLinkedPOField.updateDisplayType({displayType: 'HIDDEN'});
        }
        if (linkedOrders.length) {
          const orderNumbers = query.runSuiteQL(`
            SELECT id, tranId doc_no FROM transaction WHERE id IN (${[...new Set(linkedOrders)].join(',')})
          `).asMappedResults();
          form.addPageInitMessage({
            type: '1',
            title: 'Linked Purchase Orders',
            message: 'There are PO(s) created: ' + orderNumbers.map(({id, doc_no}) =>
              `<a href="/app/accounting/transactions/purchord.nl?id=${id}" target="_blank">${doc_no}</a>`).join(', '),
          });
        }
      } catch (e) {
        log.error('beforeLoad', e.toJSON ? e : (e.stack ? e.stack : e.toString()));
      }
    };

    const setFieldFromWOtoPO = (woRecord, poRecord) => {
      const linkedFields = runtime.getCurrentScript().getParameter({name: 'custscript_dps_ue_sale_copy_field'}).replaceAll(' ', '').split(',');
      linkedFields.forEach(field => {
        const value = woRecord.getValue(field);
        if (value) poRecord.setValue(field, value);
      });
    };

    const beforeSubmit = context => {
      try {
        const {type, newRecord} = context;

        // Outsourced work order → PO header fields (unchanged).
        const sourWOId = newRecord.getSublistValue({sublistId: 'item', line: 0, fieldId: 'createdoutsourcedwokey'});
        if (sourWOId && type === 'create') {
          const woRecord = record.load({type: record.Type.WORK_ORDER, id: sourWOId});
          setFieldFromWOtoPO(woRecord, newRecord);
        }

        if (newRecord.type !== 'salesorder') return;
        const projectId = newRecord.getValue('job');
        const specCache = new Map();

        // ── FIX 1 · drop every non-reciprocal link before anything reads them ──
        const soLinks = [];
        for (let line = 0; line < newRecord.getLineCount({sublistId}); line++) {
          soLinks.push({
            line,
            uniqueKey: newRecord.getSublistValue({sublistId, line, fieldId: 'lineuniquekey'}),
            linkedOrder: newRecord.getSublistValue({sublistId, line, fieldId: FIELD.LINKED_ORDER}),
            orderLineKey: newRecord.getSublistValue({sublistId, line, fieldId: FIELD.ORDER_LINE_KEY}),
          });
        }
        const namedPoKeys = soLinks.filter(s => s.linkedOrder && num(s.orderLineKey)).map(s => s.orderLineKey);
        const namedPoLines = namedPoKeys.length ? query.runSuiteQL(`
            SELECT uniqueKey unique_key, transaction, ${FIELD.ORDER_LINE_KEY} order_line_key
            FROM transactionLine WHERE uniqueKey IN (${inList(namedPoKeys)})
          `).asMappedResults().map(r => ({uniqueKey: r.unique_key, transaction: r.transaction, orderLineKey: r.order_line_key}))
          : [];
        for (const bad of invalidLinks(soLinks, namedPoLines)) {
          log.audit('clearNonReciprocalLink', {soId: newRecord.id, line: bad.line, reason: bad.reason});
          newRecord.setSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line: bad.line, value: ''});
          newRecord.setSublistValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, line: bad.line, value: ''});
        }

        const manualLinkedPO = newRecord.getValue(FIELD.MANUAL_LINKED_PO);
        const isCreatePO = newRecord.getValue(FIELD.CREATE_POS);
        if (!manualLinkedPO && !isCreatePO) return;

        const vendorSet = new Set();
        const dataLines = [];
        const existingPOs = [];
        const emptyPOLines = [];
        for (let line = 0; line < newRecord.getLineCount({sublistId}); line++) {
          const linkedOrder = newRecord.getSublistValue({sublistId, line, fieldId: FIELD.LINKED_ORDER});
          const vendor = newRecord.getSublistValue({sublistId, line, fieldId: FIELD.PO_VENDOR});
          const unitCost = newRecord.getSublistValue({sublistId, line, fieldId: 'custcol_dps_unit_cost'});
          const lineUniqueKey = num(newRecord.getSublistValue({sublistId, line, fieldId: 'lineuniquekey'}));
          const item = newRecord.getSublistValue({sublistId, line, fieldId: 'item'});
          const quantity = newRecord.getSublistValue({sublistId, line, fieldId: 'quantity'});
          const orderLineKey = newRecord.getSublistValue({sublistId, line, fieldId: FIELD.ORDER_LINE_KEY});

          if (linkedOrder) existingPOs.push({vendor, linkedOrder});
          else emptyPOLines.push({line, uniqueKey: lineUniqueKey, orderLineKey});

          if (linkedOrder || !vendor || !unitCost) continue;
          vendorSet.add(vendor);
          dataLines.push({
            line, vendor, lineUniqueKey, item, quantity,
            rate: unitCost,
            description: newRecord.getSublistValue({sublistId, line, fieldId: 'description'}),
            specLink: newRecord.getSublistValue({sublistId, line, fieldId: FIELD.SPEC_LINK}),
          });
        }

        if (isCreatePO && !manualLinkedPO) {
          for (const vendor of vendorSet) {
            const relatedLines = dataLines.filter(l => l.vendor === vendor);
            const existingPO = existingPOs.find(po => po.vendor === vendor);
            const poRecord = existingPO
              ? record.load({type: record.Type.PURCHASE_ORDER, id: existingPO.linkedOrder, isDynamic: true})
              : record.create({type: record.Type.PURCHASE_ORDER, isDynamic: true});

            if (!existingPO) {
              poRecord.setValue('customform', 218); // The DPS - Purchase Order
              poRecord.setValue('entity', vendor);
              const linkedFields = ['subsidiary', 'location', 'cseg_dps_bus_seg', 'custbody_project_manager', 'custbody_dps_project_source', 'custbody_dps_project_service', 'custbody_dps_related_opportunity', 'shipdate'];
              const hubSpotFields = runtime.getCurrentScript().getParameter({name: 'custscript_dps_ue_sale_copy_field'}).replaceAll(' ', '').split(',');
              linkedFields.push(...hubSpotFields);
              linkedFields.forEach(field => {
                const value = newRecord.getValue(field);
                if (value && field !== 'custbody_dps_est_invoice_date') poRecord.setValue(field, value);
              });
              const soPo = newRecord.getValue('otherrefnum');
              if (soPo) poRecord.setValue('custbody_dps_client_po', soPo);
            }
            const shipDate = newRecord.getValue('shipdate');

            for (const l of relatedLines) {
              poRecord.selectNewLine({sublistId});
              poRecord.setCurrentSublistValue({sublistId, fieldId: 'item', value: l.item});
              poRecord.setCurrentSublistValue({sublistId, fieldId: 'quantity', value: l.quantity});
              poRecord.setCurrentSublistValue({sublistId, fieldId: 'rate', value: l.rate});
              poRecord.setCurrentSublistValue({sublistId, fieldId: 'description', value: l.description});
              poRecord.setCurrentSublistValue({sublistId, fieldId: 'expectedreceiptdate', value: shipDate});
              poRecord.setCurrentSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, value: newRecord.id});
              poRecord.setCurrentSublistValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, value: l.lineUniqueKey});
              // FIX 4 · the ordered spec travels with its line.
              if (l.specLink) {
                poRecord.setCurrentSublistValue({sublistId, fieldId: FIELD.SPEC_LINK, value: l.specLink});
                poRecord.setCurrentSublistValue({sublistId, fieldId: FIELD.SPEC_TEXT, value: specTextFor(l.specLink, specCache)});
              }
              if (projectId) poRecord.setCurrentSublistValue({sublistId, fieldId: 'customer', value: projectId});
              poRecord.commitLine({sublistId});
            }
            const poId = poRecord.save({ignoreMandatoryFields: true});

            // FIX 2 · read back THIS PO's line keys, compared as numbers.
            const linkedPOLines = query.runSuiteQL(`
              SELECT ${FIELD.ORDER_LINE_KEY} sales_order_line_key, uniqueKey po_line_key
              FROM transactionLine
              WHERE transaction = ${Number(poId)}
                AND ${FIELD.ORDER_LINE_KEY} IN (${inList(relatedLines.map(l => l.lineUniqueKey))})
            `).asMappedResults();
            for (const l of relatedLines) {
              const found = linkedPOLines.find(r => num(r.sales_order_line_key) === num(l.lineUniqueKey));
              newRecord.setSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line: l.line, value: poId});
              newRecord.setSublistValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, line: l.line,
                value: found ? num(found.po_line_key) : ''});
              if (!found) log.error('createPO.lineKeyNotFound', {poId, soLineKey: l.lineUniqueKey});
            }
          }
          newRecord.setValue(FIELD.CREATE_POS, false);
        }

        // ── FIX 3 · manual link by line key only ──────────────────────────────
        if (manualLinkedPO) {
          const poRecord = record.load({type: record.Type.PURCHASE_ORDER, id: manualLinkedPO});
          const poLines = [];
          for (let i = 0; i < poRecord.getLineCount({sublistId}); i++) {
            poLines.push({
              index: i,
              uniqueKey: poRecord.getSublistValue({sublistId, fieldId: 'lineuniquekey', line: i}),
              orderLineKey: poRecord.getSublistValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, line: i}),
              linkedOrder: poRecord.getSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line: i}),
            });
          }
          const pairs = manualPairs(emptyPOLines, poLines, newRecord.id);
          for (const p of pairs) {
            poRecord.setSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line: p.poIndex, value: newRecord.id});
            poRecord.setSublistValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, line: p.poIndex, value: p.soUniqueKey});
            const specLink = newRecord.getSublistValue({sublistId, fieldId: FIELD.SPEC_LINK, line: p.soLine});
            if (specLink) {
              poRecord.setSublistValue({sublistId, fieldId: FIELD.SPEC_LINK, line: p.poIndex, value: specLink});
              poRecord.setSublistValue({sublistId, fieldId: FIELD.SPEC_TEXT, line: p.poIndex, value: specTextFor(specLink, specCache)});
            }
            newRecord.setSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line: p.soLine, value: manualLinkedPO});
            newRecord.setSublistValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, line: p.soLine, value: p.poUniqueKey});
          }
          log.audit('manualLink', {po: manualLinkedPO, paired: pairs.length, unpairedSoLines: emptyPOLines.length - pairs.length});
          if (pairs.length) {
            poRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
            newRecord.setValue(FIELD.MANUAL_LINKED_PO, '');
          }
        }
      } catch (e) {
        log.error('beforeSubmit', e.toJSON ? e : (e.stack ? e.stack : e.toString()));
      }
    };

    const afterSubmit = context => {
      try {
        const {newRecord, oldRecord} = context;
        const status = newRecord.getValue('orderstatus');
        if (!['A', 'B', 'D', 'E'].includes(status)) return;

        if (newRecord.type === 'salesorder') {
          // SO lines removed → PO lines removed (unchanged).
          const removedLines = query.runSuiteQL(`
            WITH so_lines AS (SELECT uniqueKey FROM transactionLine WHERE transaction = ${newRecord.id}),
                 po_lines AS (
                   SELECT tl.transaction, tl.${FIELD.ORDER_LINE_KEY}
                   FROM transactionLine tl JOIN transaction t ON t.id = tl.transaction
                   WHERE tl.${FIELD.LINKED_ORDER} = ${newRecord.id} AND t.recordType = 'purchaseorder')
            SELECT p.transaction po_id, p.${FIELD.ORDER_LINE_KEY} po_line_key, s.uniqueKey sales_order_line_key
            FROM po_lines p LEFT JOIN so_lines s ON s.uniqueKey = p.${FIELD.ORDER_LINE_KEY}
            WHERE s.uniqueKey IS NULL
          `).asMappedResults();
          if (removedLines.length > 0) {
            for (const poId of new Set(removedLines.map(l => l.po_id))) {
              const poRecord = record.load({type: record.Type.PURCHASE_ORDER, id: poId});
              for (const r of removedLines.filter(l => l.po_id === poId)) {
                const idx = poRecord.findSublistLineWithValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, value: r.po_line_key});
                if (idx !== -1) poRecord.removeLine({sublistId, line: idx});
              }
              if (poRecord.getLineCount({sublistId}) === 0) record.delete({type: record.Type.PURCHASE_ORDER, id: poId});
              else poRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
            }
          }

          // SO → PO line sync. Joined on the PO line's back-key, so only a
          // reciprocal pair is ever synced. FIX 4 adds the ordered-spec link.
          const matchingFields = [
            {salesField: 'item', poField: 'item'},
            {salesField: 'quantity', poField: 'quantity'},
            {salesField: 'custcol_dps_unit_cost', poField: 'rate'},
            {salesField: 'description', poField: 'description'},
            {salesField: 'isclosed', poField: 'isclosed'},
            {salesField: FIELD.SPEC_LINK, poField: FIELD.SPEC_LINK},
          ];
          const relatedLines = query.runSuiteQL(`
            SELECT s.uniqueKey sales_order_line_key, p.transaction po_id, p.uniqueKey po_line_key
            FROM transactionLine s
            JOIN transactionLine p ON p.${FIELD.ORDER_LINE_KEY} = s.uniqueKey AND p.transaction = s.${FIELD.LINKED_ORDER}
            WHERE s.transaction = ${newRecord.id}
              AND p.isFullyShipped = 'F'
              AND (s.item != p.item
                OR s.quantity != -p.quantity
                OR TO_NUMBER(s.custcol_dps_unit_cost) != p.rate
                OR s.memo != p.memo
                OR s.isclosed != p.isclosed
                OR NVL(s.${FIELD.SPEC_LINK}, 0) != NVL(p.${FIELD.SPEC_LINK}, 0))
          `).asMappedResults();
          if (relatedLines.length === 0) return;
          const specCache = new Map();
          for (const poId of new Set(relatedLines.map(l => l.po_id))) {
            const poRecord = record.load({type: record.Type.PURCHASE_ORDER, id: poId});
            for (const r of relatedLines.filter(l => l.po_id === poId)) {
              const poIdx = poRecord.findSublistLineWithValue({sublistId, fieldId: 'lineuniquekey', value: r.po_line_key});
              const soIdx = newRecord.findSublistLineWithValue({sublistId, fieldId: 'lineuniquekey', value: r.sales_order_line_key});
              if (poIdx === -1 || soIdx === -1) continue;
              for (const {salesField, poField} of matchingFields) {
                poRecord.setSublistValue({sublistId, fieldId: poField, line: poIdx,
                  value: newRecord.getSublistValue({sublistId, fieldId: salesField, line: soIdx})});
              }
              const specLink = newRecord.getSublistValue({sublistId, fieldId: FIELD.SPEC_LINK, line: soIdx});
              poRecord.setSublistValue({sublistId, fieldId: FIELD.SPEC_TEXT, line: poIdx, value: specTextFor(specLink, specCache)});
            }
            poRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
          }
        } else if (newRecord.type === 'purchaseorder') {
          const oldVendorId = oldRecord ? oldRecord.getValue('entity') : null;
          const newVendorId = newRecord.getValue('entity');
          if (oldRecord && oldVendorId !== newVendorId) {
            const relatedLines = query.runSuiteQL(`
              SELECT s.transaction so_id, s.uniqueKey sales_order_line_key
              FROM transactionLine s
              JOIN transactionLine p ON p.${FIELD.ORDER_LINE_KEY} = s.uniqueKey AND s.${FIELD.LINKED_ORDER} = p.transaction
              WHERE p.transaction = ${newRecord.id} AND p.${FIELD.ORDER_LINE_KEY} IS NOT NULL
            `).asMappedResults();
            for (const soId of new Set(relatedLines.map(l => l.so_id))) {
              const soRecord = record.load({type: record.Type.SALES_ORDER, id: soId});
              for (const r of relatedLines.filter(l => l.so_id === soId)) {
                const idx = soRecord.findSublistLineWithValue({sublistId, fieldId: 'lineuniquekey', value: r.sales_order_line_key});
                if (idx !== -1) soRecord.setSublistValue({sublistId, fieldId: FIELD.PO_VENDOR, line: idx, value: newVendorId});
              }
              soRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
            }
          }

          // Outsourced work orders (unchanged).
          const outsourcedWOs = [];
          const poVendor = newRecord.getValue('entity');
          for (let line = 0; line < newRecord.getLineCount({sublistId}); line++) {
            const outsourcedWO = newRecord.getSublistValue({sublistId, line, fieldId: 'createdoutsourcedwokey'});
            const linkedOrder = newRecord.getSublistValue({sublistId, line, fieldId: FIELD.LINKED_ORDER});
            if (outsourcedWO && !linkedOrder) {
              const lineUniqueKey = newRecord.getSublistValue({sublistId, line, fieldId: 'lineuniquekey'});
              const linkedSOLine = query.runSuiteQL(`
                SELECT transaction, uniquekey FROM transactionLine WHERE createdpo = ${outsourcedWO}
              `).asMappedResults()[0];
              if (linkedSOLine) {
                const soRecord = record.load({type: record.Type.SALES_ORDER, id: linkedSOLine.transaction});
                const foundLine = soRecord.findSublistLineWithValue({sublistId, fieldId: 'lineuniquekey', value: linkedSOLine.uniquekey});
                if (foundLine !== -1) {
                  soRecord.setSublistValue({sublistId, fieldId: FIELD.PO_VENDOR, line: foundLine, value: poVendor});
                  soRecord.setSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line: foundLine, value: newRecord.id});
                  soRecord.setSublistValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, line: foundLine, value: lineUniqueKey});
                  soRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
                  outsourcedWOs.push({line, linkedOrder: linkedSOLine.transaction, linkedLine: linkedSOLine.uniquekey});
                }
              }
            }
          }
          if (outsourcedWOs.length) {
            const poRecord = record.load({type: record.Type.PURCHASE_ORDER, id: newRecord.id});
            for (const {line, linkedOrder, linkedLine} of outsourcedWOs) {
              poRecord.setSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line, value: linkedOrder});
              poRecord.setSublistValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, line, value: linkedLine});
            }
            poRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
          }
        }
      } catch (e) {
        log.error('afterSubmit', e.toJSON ? e : (e.stack ? e.stack : e.toString()));
      }
    };

    return {beforeLoad, beforeSubmit, afterSubmit, _test: {invalidLinks, manualPairs}};
  },
);
