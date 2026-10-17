/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 * @NScriptType UserEventScript
 * @see [Help Center (Private)]{@link https://system.netsuite.com/app/help/helpcenter.nl?fid=section_4387799721}
 * @see [Help Center (Public)]{@link https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_4387799721.html}
 * @see [File Templates]{@link https://github.com/burkybang/SuiteScript-WebStorm-File-Templates}
 * @see [Type Declarations]{@link https://github.com/burkybang/SuiteScript-2.0-Type-Declarations}
 * @author
 */
define(['N/query', 'N/record', 'N/runtime'],
  
  /**
   * @param {query} query
   * @param {record} record
   * @param {runtime} runtime
   * @return {{
   *   beforeLoad?: Function,
   *   beforeSubmit?: Function,
   *   afterSubmit?: Function,
   * }}
   */
  (query, record, runtime) => {
    
    const FIELD = {
      MANUAL_LINKED_PO: 'custbody_ali_manual_linked_po',
      CREATE_POS: 'custbody_dps_create_pos',
      PO_VENDOR: 'custcol_dps_po_vendor',
      LINKED_ORDER: 'custcol_dps_linked_order',
      ORDER_LINE_KEY: 'custcol_dps_order_line_key',
    };
    
    /**
     * @param {BeforeLoadContext} context
     * @return {void}
     */
    const beforeLoad = context => {
      try {
        log.audit('beforeLoad', {
          type: context.type,
          form: context.form,
          newRecord: {
            type: context.newRecord.type,
            id: context.newRecord.id,
          },
          request: !context.request ? null : {
            url: context.request.url,
            parameters: context.request.parameters,
          },
        });
        const {type, newRecord, form, request} = context;
        
        if (newRecord.type !== 'salesorder') return;
        
        let emptyPOLine = false;
        const linkedOrders = [];
        for (let line = 0; line < newRecord.getLineCount({sublistId: 'item'}); line++) {
          const linkedOrder = newRecord.getSublistValue({sublistId: 'item', fieldId: FIELD.LINKED_ORDER, line});
          if (linkedOrder) {
            linkedOrders.push(linkedOrder);
          } else {
            emptyPOLine = true;
          }
        }
        log.debug('emptyPOLine', emptyPOLine);
        if (!emptyPOLine) {
          const manualLinkedPOField = form.getField({id: FIELD.MANUAL_LINKED_PO});
          if (manualLinkedPOField) manualLinkedPOField.updateDisplayType({displayType: 'HIDDEN'});
        }
        
        // Add initial message to the form
        if (linkedOrders.length) {
          /** @type {Array<{id: number, doc_no: string}>} */
          const orderNumbers = query.runSuiteQL(`
            SELECT id, tranId doc_no FROM transaction WHERE id IN (${linkedOrders.join(',')})
          `).asMappedResults();
          log.debug('orderNumbers', orderNumbers);
          form.addPageInitMessage({
            type: '1',
            title: 'Linked Purchase Orders',
            message: 'There are PO(s) created: ' + orderNumbers.map(({
                                                                       id,
                                                                       doc_no,
                                                                     }) => `<a href="/app/accounting/transactions/purchord.nl?id=${id}" target="_blank">${doc_no}</a>`).join(', '),
          });
        }
        
      } catch (e) {
        log.error('beforeLoad', e.toJSON ? e : (e.stack ? e.stack : e.toString()));
      }
    };
    
    const setFieldFromWOtoPO = (woRecord, poRecord) => {
      const linkedFields = runtime.getCurrentScript().getParameter({name: 'custscript_dps_ue_sale_copy_field'}).replaceAll(' ', '').split(',')
      linkedFields.forEach(field => {
        const value = woRecord.getValue(field);
        if (value) {
          poRecord.setValue(field, value);
        }
      });
    }
    
    /**
     * @param {BeforeSubmitContext} context
     * @return {void}
     */
    const beforeSubmit = context => {
      try {
        log.audit('beforeSubmit', {
          type: context.type,
          newRecord: {
            type: context.newRecord.type,
            id: context.newRecord.id,
          },
          oldRecord: !context.oldRecord ? null : {
            type: context.oldRecord.type,
            id: context.oldRecord.id,
          },
        });
        const {type, newRecord, oldRecord} = context;
        
        // Set fields from WO to PO for outsourced item
        let sourWOId = newRecord.getSublistValue({sublistId: 'item', line: 0, fieldId: 'createdoutsourcedwokey'});
        if (sourWOId && (type === 'create')) {
          log.debug('sourWOId', sourWOId);
          const woRecord = record.load({type: record.Type.WORK_ORDER, id: sourWOId});
          setFieldFromWOtoPO(woRecord, newRecord);
        }
        
        if (newRecord.type !== 'salesorder') return;
        
        const sublistId = 'item';
        const projectId = newRecord.getValue('job');
        // Handle logic for line copy
        for (let line = 0; line < newRecord.getLineCount({sublistId}); line++) {
          const linkedOrder = newRecord.getSublistValue({sublistId, line, fieldId: FIELD.LINKED_ORDER});
          const lineUniqueKey = +newRecord.getSublistValue({sublistId, line, fieldId: 'lineuniquekey'});
          log.debug('lineUniqueKey', lineUniqueKey);
          if (!lineUniqueKey && linkedOrder) {
            newRecord.setSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line, value: ''});
            newRecord.setSublistValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, line, value: ''});
          }
        }
        
        
        /** @type {string} */
        const manualLinkedPO = newRecord.getValue(FIELD.MANUAL_LINKED_PO);
        const isCreatePO = newRecord.getValue(FIELD.CREATE_POS);
        if (!manualLinkedPO && !isCreatePO) return;
        /** @type {Set<string>} */
        const vendorSet = new Set();
        /** @type {Array<{line: number, vendor: string, lineUniqueKey: number, item: string, sku: string, quantity: number, rate: number, description: string}>} */
        const dataLines = [];
        /** @type {Array<{vendor: string, linkedOrder: string}>} */
        const existingPOs = [];
        /** @type {Array<{line: number, vendor: string, lineUniqueKey: number, item: string, quantity: number, linkedLine: ?number}>} */
        const emptyPOLines = [];
        for (let line = 0; line < newRecord.getLineCount({sublistId}); line++) {
          const linkedOrder = newRecord.getSublistValue({sublistId, line, fieldId: FIELD.LINKED_ORDER});
          const vendor = newRecord.getSublistValue({sublistId, line, fieldId: FIELD.PO_VENDOR});
          const unitCost = newRecord.getSublistValue({sublistId, line, fieldId: 'custcol_dps_unit_cost'});
          const lineUniqueKey = +newRecord.getSublistValue({sublistId, line, fieldId: 'lineuniquekey'});
          log.debug('lineUniqueKey', lineUniqueKey);
          const item = newRecord.getSublistValue({sublistId, line, fieldId: 'item'});
          const quantity = newRecord.getSublistValue({sublistId, line, fieldId: 'quantity'});
          
          if (linkedOrder) {
            existingPOs.push({vendor, linkedOrder});
          } else {
            emptyPOLines.push({line, vendor, lineUniqueKey, item, quantity, linkedLine: undefined});
          }
          
          if (linkedOrder || !vendor || !unitCost) continue;
          vendorSet.add(vendor);
          
          dataLines.push({
            line,
            vendor,
            lineUniqueKey: lineUniqueKey,
            item: item,
            quantity: quantity,
            rate: unitCost,
            description: newRecord.getSublistValue({sublistId, line, fieldId: 'description'}),
          });
        }
        log.debug('dataLines', dataLines);
        if (isCreatePO && !manualLinkedPO) {
          if (dataLines.length > 0) {
            for (const vendor of vendorSet) {
              const relatedLines = dataLines.filter(line => line.vendor === vendor);
              log.debug('relatedLines', relatedLines);
              
              const existingPO = existingPOs.find(po => po.vendor === vendor);
              log.debug('existingPO', existingPO);
              
              const poRecord = existingPO ? record.load({type: record.Type.PURCHASE_ORDER, id: existingPO.linkedOrder, isDynamic: true})
                : record.create({type: record.Type.PURCHASE_ORDER, isDynamic: true});
              
              if (!existingPO) {
                poRecord.setValue('customform', 218); //The DPS - Purchase Order form
                poRecord.setValue('entity', vendor);
                const linkedFields = ['subsidiary', 'location', 'cseg_dps_bus_seg', 'custbody_project_manager', 'custbody_dps_project_source', 'custbody_dps_project_service', 'custbody_dps_related_opportunity', 'shipdate']; //TODO: Add more fields per documents
                const hubSpotFields = runtime.getCurrentScript().getParameter({name: 'custscript_dps_ue_sale_copy_field'}).replaceAll(' ', '').split(',');
                linkedFields.push(...hubSpotFields);
                
                linkedFields.forEach(field => {
                  const value = newRecord.getValue(field);
                  if (value && field !== 'custbody_dps_est_invoice_date') {
                    // log.debug('linkedField', {field, value});
                    poRecord.setValue(field, value);
                  }
                });
                
                const mappingFields = [
                  {salesField: 'otherrefnum', poField: 'custbody_dps_client_po'},
                ];
                for (const mappingField of mappingFields) {
                  const soValue = newRecord.getValue(mappingField.salesField);
                  if (soValue) {
                    // log.debug('mappingField', {field: mappingField.salesField, soValue});
                    poRecord.setValue(mappingField.poField, soValue);
                  }
                }
              }
              const shipDate = newRecord.getValue('shipdate');
              
              for (let i = 0; i < relatedLines.length; i++) {
                poRecord.selectNewLine({sublistId: 'item'});
                poRecord.setCurrentSublistValue({sublistId: 'item', fieldId: 'item', value: relatedLines[i].item});
                poRecord.setCurrentSublistValue({sublistId: 'item', fieldId: 'quantity', value: relatedLines[i].quantity});
                poRecord.setCurrentSublistValue({sublistId: 'item', fieldId: 'rate', value: relatedLines[i].rate});
                poRecord.setCurrentSublistValue({sublistId: 'item', fieldId: 'description', value: relatedLines[i].description});
                poRecord.setCurrentSublistValue({sublistId: 'item', fieldId: 'expectedreceiptdate', value: shipDate});
                poRecord.setCurrentSublistValue({sublistId: 'item', fieldId: FIELD.LINKED_ORDER, value: newRecord.id});
                poRecord.setCurrentSublistValue({sublistId: 'item', fieldId: FIELD.ORDER_LINE_KEY, value: relatedLines[i].lineUniqueKey});
                if (projectId) poRecord.setCurrentSublistValue({sublistId: 'item', fieldId: 'customer', value: projectId});
                poRecord.commitLine({sublistId: 'item'});
              }
              log.debug('poRecord', poRecord);
              const poId = poRecord.save({ignoreMandatoryFields: true});
              log.debug('Created PO Id', poId);
              /** @type {[{sales_order_line_key: number, po_line_key: number}]} */
              const linkedPOLines = query.runSuiteQL(`
              SELECT ${FIELD.ORDER_LINE_KEY} sales_order_line_key, uniqueKey po_line_key
              FROM transactionLine
              WHERE ${FIELD.ORDER_LINE_KEY} IN (${relatedLines.map(line => `'${line.lineUniqueKey}'`).join(',')})
            `).asMappedResults();
              log.debug('linkedPOLines', linkedPOLines);
              for (const relatedLine of relatedLines) {
                newRecord.setSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line: relatedLine.line, value: poId});
                const foundPOline = linkedPOLines.find(({sales_order_line_key}) => sales_order_line_key === relatedLine.lineUniqueKey);
                if (foundPOline) newRecord.setSublistValue({
                  sublistId,
                  fieldId: FIELD.ORDER_LINE_KEY,
                  line: relatedLine.line,
                  value: foundPOline.po_line_key,
                });
              }
            }
          }
          newRecord.setValue(FIELD.CREATE_POS, false);
        }
        
        if (manualLinkedPO) {
          log.debug('emptyPOLines', emptyPOLines);
          const poRecord = record.load({type: record.Type.PURCHASE_ORDER, id: manualLinkedPO});
          let isPOChanged = false;
          for (let i = 0; i < poRecord.getLineCount({sublistId}); i++) {
            // const linkedOrder = poRecord.getSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line: i});
            // if (linkedOrder) continue;
            const item = poRecord.getSublistValue({sublistId, fieldId: 'item', line: i});
            const quantity = poRecord.getSublistValue({sublistId, fieldId: 'quantity', line: i});
            const relatedLine = emptyPOLines.find(line => line.item === item && line.quantity === quantity && !line.linkedLine);
            log.debug('relatedLine', relatedLine);
            if (relatedLine) {
              poRecord.setSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line: i, value: newRecord.id});
              poRecord.setSublistValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, line: i, value: relatedLine.lineUniqueKey});
              isPOChanged = true;
              relatedLine.linkedLine = +poRecord.getSublistValue({sublistId, fieldId: 'lineuniquekey', line: i});
              newRecord.setSublistValue({sublistId, fieldId: FIELD.LINKED_ORDER, line: relatedLine.line, value: manualLinkedPO});
              newRecord.setSublistValue({sublistId, fieldId: FIELD.ORDER_LINE_KEY, line: relatedLine.line, value: relatedLine.linkedLine});
            }
          }
          if (isPOChanged) {
            poRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
            newRecord.setValue(FIELD.MANUAL_LINKED_PO, '');
          }
        }
      } catch (e) {
        log.error('beforeSubmit', e.toJSON ? e : (e.stack ? e.stack : e.toString()));
      }
    };
    
    /**
     * @param {AfterSubmitContext} context
     * @return {void}
     */
    const afterSubmit = context => {
      try {
        log.audit('afterSubmit', {
          type: context.type,
          newRecord: {
            type: context.newRecord.type,
            id: context.newRecord.id,
          },
          oldRecord: !context.oldRecord ? null : {
            type: context.oldRecord.type,
            id: context.oldRecord.id,
          },
        });
        const {type, newRecord, oldRecord} = context;
        // Check if the PO line is changed, then update po lines.
        const status = newRecord.getValue('orderstatus');
        log.debug('Order Status', status);
        if (!['A', 'B', 'D', 'E'].includes(status)) return;
        const sublistId = 'item';
        
        if (newRecord.type === 'salesorder') {
          // Handle for so line removed
          const removedLines = query.runSuiteQL(`
            WITH so_lines AS (SELECT uniqueKey
                              FROM transactionLine
                              WHERE
              TRANSACTION = ${newRecord.id}
              )
               , po_lines AS (
            SELECT
              tl.transaction, tl.
              ${FIELD.ORDER_LINE_KEY}
            FROM transactionLine tl
              JOIN TRANSACTION t
            ON t.id = tl.transaction
            WHERE ${FIELD.LINKED_ORDER} = ${newRecord.id}
              AND t.recordType = 'purchaseorder'
              )
            SELECT
              p.transaction po_id,
              p.${FIELD.ORDER_LINE_KEY} po_line_key,
              s.uniqueKey sales_order_line_key
            FROM po_lines p
                   LEFT JOIN so_lines s ON s.uniqueKey = p.${FIELD.ORDER_LINE_KEY}
            WHERE s.uniqueKey IS NULL
          `).asMappedResults();
          log.debug('removedLines', removedLines);
          
          if (removedLines.length > 0) {
            const removePoIds = new Set(removedLines.map(line => line.po_id));
            for (const poId of removePoIds) {
              const poRecord = record.load({type: record.Type.PURCHASE_ORDER, id: poId});
              for (const removedLine of removedLines.filter(line => line.po_id === poId)) {
                const poLineIndex = poRecord.findSublistLineWithValue({
                  sublistId: 'item',
                  fieldId: FIELD.ORDER_LINE_KEY,
                  value: removedLine.po_line_key,
                });
                if (poLineIndex === -1) continue;
                poRecord.removeLine({sublistId: 'item', line: poLineIndex});
              }
              const lineCount = poRecord.getLineCount({sublistId: 'item'});
              if (lineCount === 0) {
                record.delete({type: record.Type.PURCHASE_ORDER, id: poId});
              } else {
                poRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
              }
            }
          }
          
          const matchingFields = [
            {
              salesField: 'item',
              poField: 'item',
            },
            {
              salesField: 'quantity',
              poField: 'quantity',
            },
            {
              salesField: 'custcol_dps_unit_cost',
              poField: 'rate',
            },
            {
              salesField: 'description',
              poField: 'description',
            },
            {
              salesField: 'isclosed',
              poField: 'isclosed',
            },
          ];
          const queryString = `
          SELECT s.uniqueKey sales_order_line_key, p.transaction po_id, p.uniqueKey po_line_key
          FROM transactionLine s
          JOIN transactionLine p ON p.${FIELD.ORDER_LINE_KEY} = s.uniqueKey
          WHERE s.transaction = ${newRecord.id}
          AND p.isFullyShipped = 'F'
          AND (
            s.item != p.item
            OR s.quantity != -p.quantity
            OR TO_NUMBER(s.custcol_dps_unit_cost) != p.rate
            OR s.memo != p.memo
            OR s.isclosed != p.isclosed
            )
        `;
          const relatedLines = query.runSuiteQL(queryString).asMappedResults();
          log.debug('Need to update lines', relatedLines);
          if (relatedLines.length === 0) return;
          const poIds = new Set(relatedLines.map(line => line.po_id));
          for (const poId of poIds) {
            const poRecord = record.load({type: record.Type.PURCHASE_ORDER, id: poId});
            for (const relatedLine of relatedLines.filter(line => line.po_id === poId)) {
              const poLineIndex = poRecord.findSublistLineWithValue({
                sublistId: 'item',
                fieldId: 'lineuniquekey',
                value: relatedLine.po_line_key,
              });
              if (poLineIndex === -1) continue;
              const salesLineIndex = newRecord.findSublistLineWithValue({
                sublistId: 'item',
                fieldId: 'lineuniquekey',
                value: relatedLine.sales_order_line_key,
              });
              for (const {salesField, poField} of matchingFields) {
                const salesValue = newRecord.getSublistValue({
                  sublistId: 'item',
                  fieldId: salesField,
                  line: salesLineIndex,
                });
                poRecord.setSublistValue({
                  sublistId: 'item',
                  fieldId: poField,
                  line: poLineIndex,
                  value: salesValue,
                });
              }
            }
            poRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
          }
        } else if (newRecord.type === 'purchaseorder') {
          const oldVendorId = oldRecord.getValue('entity');
          const newVendorId = newRecord.getValue('entity');
          if (oldVendorId !== newVendorId) {
            // Update new vendor to all related sales order lines
            log.debug('Vendor changed', {oldVendorId, newVendorId});
            const relatedLines = query.runSuiteQL(`
            SELECT s.transaction so_id, s.uniqueKey sales_order_line_key, p.transaction po_id, p.uniqueKey po_line_key
            FROM transactionLine s
            JOIN transactionLine p ON p.${FIELD.ORDER_LINE_KEY} = s.uniqueKey
            WHERE p.transaction = ${newRecord.id} AND p.${FIELD.ORDER_LINE_KEY} IS NOT NULL
          `).asMappedResults();
            log.debug('relatedLines to update SO', relatedLines);
            if (relatedLines.length === 0) return;
            const soIds = new Set(relatedLines.map(line => line.so_id));
            for (const soId of soIds) {
              const soRecord = record.load({type: record.Type.SALES_ORDER, id: soId});
              for (const relatedLine of relatedLines.filter(line => line.so_id === soId)) {
                const soLineIndex = soRecord.findSublistLineWithValue({
                  sublistId: 'item',
                  fieldId: 'lineuniquekey',
                  value: relatedLine.sales_order_line_key,
                });
                if (soLineIndex === -1) continue;
                soRecord.setSublistValue({
                  sublistId: 'item',
                  fieldId: FIELD.PO_VENDOR,
                  line: soLineIndex,
                  value: newVendorId,
                });
              }
              soRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
            }
          }
          
          const outsourcedWOs = [];
          const poVendor = newRecord.getValue('entity');
          for (let line = 0; line < newRecord.getLineCount({sublistId}); line++) {
            const outsourcedWO = newRecord.getSublistValue({sublistId, line, fieldId: 'createdoutsourcedwokey'});
            const linkedOrder = newRecord.getSublistValue({sublistId, line, fieldId: FIELD.LINKED_ORDER});
            if (outsourcedWO && !linkedOrder) {
              const lineUniqueKey = newRecord.getSublistValue({sublistId, line, fieldId: 'lineuniquekey'});
              /** @type {{transaction: number, uniquekey: number}} */
              const linkedSOLine = query.runSuiteQL(`
                SELECT transaction, uniquekey FROM transactionLine WHERE createdpo = ${outsourcedWO}
                `).asMappedResults()[0];
              log.debug('linkedSOLine', linkedSOLine);
              if (linkedSOLine) {
                const soRecord = record.load({type: record.Type.SALES_ORDER, id: linkedSOLine.transaction});
                const foundLine = soRecord.findSublistLineWithValue({
                  sublistId: 'item',
                  fieldId: 'lineuniquekey',
                  value: linkedSOLine.uniquekey,
                });
                if (foundLine !== -1) {
                  soRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: FIELD.PO_VENDOR,
                    line: foundLine,
                    value: poVendor,
                  });
                  soRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: FIELD.LINKED_ORDER,
                    line: foundLine,
                    value: newRecord.id,
                  });
                  soRecord.setSublistValue({
                    sublistId: 'item',
                    fieldId: FIELD.ORDER_LINE_KEY,
                    line: foundLine,
                    value: lineUniqueKey,
                  });
                  soRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
                  outsourcedWOs.push({
                    line, linkedOrder: linkedSOLine.transaction, linkedLine: linkedSOLine.uniquekey,
                  });
                }
              }
            }
          }
          if (outsourcedWOs.length) {
            log.debug('outsourcedWOs', outsourcedWOs);
            const poRecord = record.load({type: record.Type.PURCHASE_ORDER, id: newRecord.id});
            for (const {line, linkedOrder, linkedLine} of outsourcedWOs) {
              poRecord.setSublistValue({
                sublistId: 'item',
                fieldId: FIELD.LINKED_ORDER,
                line,
                value: linkedOrder,
              });
              poRecord.setSublistValue({
                sublistId: 'item',
                fieldId: FIELD.ORDER_LINE_KEY,
                line,
                value: linkedLine,
              });
            }
            poRecord.save({enableSourcing: true, ignoreMandatoryFields: true});
          }
        }
      } catch (e) {
        log.error('afterSubmit', e.toJSON ? e : (e.stack ? e.stack : e.toString()));
      }
    };
    
    return {
      beforeLoad,
      beforeSubmit,
      afterSubmit,
    };
  },
);