import { Document, Paragraph, TextRun, Packer, HeadingLevel } from 'docx';
import * as fs from 'fs';

async function testDocx() {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            children: [
              new TextRun({ text: "Lánská Jaroslava", bold: true, size: 22 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "5551021696", size: 22 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "111", size: 22 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "71 let, 167 cm, 82 kg, ECOG PS 0", size: 22 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "NO: ", bold: true, size: 22 }),
              new TextRun({ text: "Pacientka přichází pro pánevní recidivu...", size: 22 }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Onkogynekologické konsilium 9.9.2026", bold: true, size: 22 }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync('scratch/test.docx', buffer);
  console.log('DOCX written successfully, size:', buffer.length);
}

testDocx().catch(console.error);
