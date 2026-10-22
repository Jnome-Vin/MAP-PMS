// โครงสร้างอาคารตั้งต้น (ไม่มีข้อมูลส่วนบุคคล — ไฟล์นี้เผยแพร่บน GitHub Pages)
// ข้อมูลผู้เช่า/บิล/ทะเบียนรถ นำเข้าจากไฟล์ import/initial-data.json ที่เมนู "ตั้งค่า → นำเข้าข้อมูล"

const ROOM_NOS = [2, 3, 4, 5].flatMap(f => [1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `${f}0${n}`));

export const rooms = [
  { id: '101', floor: 1, kind: 'office', label: 'สำนักงาน (Office)', type: 'ส่วนกลาง', rent: 0 },
  { id: '102', floor: 1, kind: 'laundry', label: 'ห้องเครื่องซักผ้า', type: 'ส่วนกลาง', rent: 0 },
  { id: '103', floor: 1, kind: 'kiosk', label: 'Kiosk', type: 'Kiosk', rent: 0, wRate: 17, eRate: 8 },
  ...ROOM_NOS.map(id => ({ id, floor: +id[0], kind: 'room', label: '', type: 'แอร์', rent: 0 })),
];

const SLOT_IDS = [
  ...Array.from({ length: 14 }, (_, i) => 'A-' + (i + 1)),
  ...Array.from({ length: 15 }, (_, i) => 'B-' + (i + 1)),   // B-16 ยกเลิกแล้ว
  'C-1', 'C-2', 'C-3', 'CAR-1', 'CAR-2', 'CAR-3', 'CAR-4', 'CAR-5', 'CAR-6',
];
export const slots = SLOT_IDS.map(id => ({ id, zone: id.split('-')[0], room: '', plate: '', vehicle: '' }));

export const settings = [
  { id: 'rates', water: 15, elec: 6, dueDay: 5, parkingFee: 300, fridgeFee: 250, minOn: true, minWaterUnits: 1, minWaterAmount: 15, minElecUnits: 1, minElecAmount: 6 },
  { id: 'property', name: 'มีชัย อพาร์ทเม้นท์', nameEn: 'MEECHAI APARTMENT', address: '', phone: '', taxId: '', promptpay: '',
    billNote: 'กรุณาโอนเงินมาชำระภายในวันที่ 5 ของเดือน', billNoteEn: 'YOU MUST PAY YOUR BILL WITHIN 5 DAYS', showQr: true },
];
