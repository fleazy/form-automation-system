const fs = require('fs');

// Read the contact form HTML
const htmlContent = fs.readFileSync('/Users/w0rker/Desktop/DSHID/Contact information (10_29_2025 3：08：12 PM).html', 'utf8');

console.log('File size:', htmlContent.length);
console.log('Contains forms.gle:', htmlContent.includes('forms.gle'));
console.log('Contains docs.google.com/forms:', htmlContent.includes('docs.google.com/forms'));
console.log('Contains freebirdFormviewer:', htmlContent.includes('freebirdFormviewer'));

// Test the extraction logic
const fields = [];

// Check if this is a Google Form
const isGoogleForm = htmlContent.includes('forms.gle') || htmlContent.includes('docs.google.com/forms') || htmlContent.includes('freebirdFormviewer');

console.log('Is Google Form:', isGoogleForm);

if (isGoogleForm) {
  console.log('Testing Google Forms extraction...');
  
  // Google Forms structure - look for entry points
  const entryRegex = /data-params="[^"]*entry\.([0-9]+)[^"]*"/gi;
  const entries = new Set();
  let match;
  
  while ((match = entryRegex.exec(htmlContent)) !== null) {
    entries.add(match[1]);
    console.log('Found entry via data-params:', match[1]);
  }
  
  // Also look for input elements with entry names
  const inputEntryRegex = /name="entry\.([0-9]+)"/gi;
  while ((match = inputEntryRegex.exec(htmlContent)) !== null) {
    entries.add(match[1]);
    console.log('Found entry via input name:', match[1]);
  }
  
  // Look for entry IDs in different patterns
  const entryPatterns = [
    /entry\.([0-9]+)/gi,
    /"([0-9]{9,10})"/gi,  // Google Forms often use 9-10 digit entry IDs
    /\b([0-9]{9,10})\b/g  // 9-10 digit numbers that could be entry IDs
  ];
  
  entryPatterns.forEach((pattern, index) => {
    let match;
    while ((match = pattern.exec(htmlContent)) !== null) {
      const entryId = match[1];
      if (entryId && entryId.length >= 9) {
        entries.add(entryId);
        console.log(`Found entry via pattern ${index + 1}:`, entryId);
        
        // Limit to first 10 entries to avoid too much output
        if (entries.size >= 10) break;
      }
    }
  });
  
  console.log('Total unique entries found:', entries.size);
  console.log('Entry IDs:', Array.from(entries));
  
  // Convert entries to field objects
  let fieldIndex = 0;
  entries.forEach(entryId => {
    fieldIndex++;
    
    fields.push({
      type: 'text',
      name: `entry.${entryId}`,
      id: `entry_${entryId}`,
      placeholder: `Field ${fieldIndex}`,
      required: true,
      selector: `input[name="entry.${entryId}"], textarea[name="entry.${entryId}"]`,
      entryId: entryId
    });
  });
}

console.log('\nExtracted fields:');
console.log(JSON.stringify(fields, null, 2));
console.log('\nField count:', fields.length);