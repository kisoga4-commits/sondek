export const defaultMathQuestions = [
  { type: 'multiple_choice', question: '0.4 + 0.2 = ?', choices: ['0.5', '0.6', '0.7', '0.8'], answerIndex: 1 },
  { type: 'multiple_choice', question: '1.0 - 0.7 = ?', choices: ['0.2', '0.3', '0.4', '0.5'], answerIndex: 1 },
  { type: 'multiple_choice', question: '0.3 × 0.2 = ?', choices: ['0.06', '0.6', '0.9', '0.03'], answerIndex: 0 },
  { type: 'multiple_choice', question: '0.25 × 4 = ?', choices: ['0.5', '1', '1.25', '2'], answerIndex: 1 },
  { type: 'multiple_choice', question: '50% ของ 60 = ?', choices: ['25', '30', '35', '40'], answerIndex: 1 },
  { type: 'multiple_choice', question: '10% ของ 90 = ?', choices: ['8', '9', '10', '11'], answerIndex: 1 },
  { type: 'multiple_choice', question: '0.6 + 1.1 = ?', choices: ['1.5', '1.6', '1.7', '1.8'], answerIndex: 2 },
  { type: 'multiple_choice', question: '2.5 - 0.8 = ?', choices: ['1.6', '1.7', '1.8', '1.9'], answerIndex: 1 },
  { type: 'multiple_choice', question: '0.4 × 5 = ?', choices: ['1.5', '2', '2.5', '3'], answerIndex: 1 },
  { type: 'multiple_choice', question: '25% ของ 80 = ?', choices: ['10', '15', '20', '25'], answerIndex: 2 },
  { type: 'multiple_choice', question: 'หนังสือราคา 120 บาท ลด 10% ต้องจ่ายกี่บาท', choices: ['102 บาท', '106 บาท', '108 บาท', '110 บาท'], answerIndex: 2 },
  { type: 'multiple_choice', question: 'กางเกงราคา 300 บาท ลด 20% ต้องจ่ายกี่บาท', choices: ['220 บาท', '230 บาท', '240 บาท', '250 บาท'], answerIndex: 2 },
  { type: 'multiple_choice', question: 'สี่เหลี่ยมผืนผ้า กว้าง 3 เมตร ยาว 7 เมตร พื้นที่เท่าไร', choices: ['18 ตร.ม.', '20 ตร.ม.', '21 ตร.ม.', '24 ตร.ม.'], answerIndex: 2 },
  { type: 'multiple_choice', question: 'สี่เหลี่ยมผืนผ้า กว้าง 5 ซม. ยาว 9 ซม. พื้นที่เท่าไร', choices: ['35 ตร.ซม.', '40 ตร.ซม.', '45 ตร.ซม.', '50 ตร.ซม.'], answerIndex: 2 },
  { type: 'multiple_choice', question: 'เงิน 80 บาท ซื้อขนม 26.50 บาท เหลือเท่าไร', choices: ['52.50 บาท', '53.00 บาท', '53.50 บาท', '54.00 บาท'], answerIndex: 2 },
  { type: 'multiple_choice', question: 'เงิน 150 บาท ซื้อดินสอ 35 บาท เหลือเท่าไร', choices: ['105 บาท', '110 บาท', '115 บาท', '120 บาท'], answerIndex: 2 },
  { type: 'multiple_choice', question: 'นักเรียน 40 คน 50% เป็นผู้ชาย มีกี่คน', choices: ['18 คน', '20 คน', '22 คน', '25 คน'], answerIndex: 1 },
  { type: 'multiple_choice', question: 'ต้นไม้ 20 ต้น 25% เป็นต้นมะม่วง มีกี่ต้น', choices: ['4 ต้น', '5 ต้น', '6 ต้น', '7 ต้น'], answerIndex: 1 },
  { type: 'multiple_choice', question: 'เชือกยาว 15 เมตร ตัดไป 4.5 เมตร เหลือกี่เมตร', choices: ['9.5 เมตร', '10 เมตร', '10.5 เมตร', '11 เมตร'], answerIndex: 2 },
  { type: 'multiple_choice', question: 'น้ำผลไม้ 2.5 ลิตร ดื่มไป 0.7 ลิตร เหลือเท่าไร', choices: ['1.6 ลิตร', '1.7 ลิตร', '1.8 ลิตร', '1.9 ลิตร'], answerIndex: 2 },
];

export const mixedTemplateQuestions = [
  {
    type: 'true_false',
    question: '0.75 มากกว่า 0.57',
    choices: ['จริง', 'เท็จ'],
    answerIndex: 0,
  },
  {
    type: 'multiple_choice',
    question: '15% ของ 200 เท่ากับเท่าไร?',
    choices: ['25', '30', '35', '40'],
    answerIndex: 1,
  },
  {
    type: 'ordering',
    question: 'เรียงขั้นตอนการแก้โจทย์เปอร์เซ็นต์จากต้นจนจบ',
    orderingItems: ['อ่านโจทย์และระบุค่าที่รู้', 'แปลงเปอร์เซ็นต์เป็นทศนิยม', 'คูณเพื่อหาคำตอบ'],
  },
];
