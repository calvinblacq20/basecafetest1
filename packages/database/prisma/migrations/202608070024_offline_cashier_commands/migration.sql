ALTER TABLE "sync_command_receipts"
DROP CONSTRAINT "sync_command_type_check";

ALTER TABLE "sync_command_receipts"
ADD CONSTRAINT "sync_command_type_check" CHECK (
  "command_type" IN (
    'ORDER_CREATE',
    'ORDER_LINE_ADD',
    'ORDER_LINE_REPLACE',
    'ORDER_LINE_REMOVE',
    'ORDER_HOLD',
    'ORDER_RESUME',
    'ORDER_CANCEL',
    'ORDER_SEND',
    'CASH_PAYMENT_CREATE',
    'ORDER_COMPLETE',
    'INVENTORY_CONSUMPTION_POST'
  )
);
