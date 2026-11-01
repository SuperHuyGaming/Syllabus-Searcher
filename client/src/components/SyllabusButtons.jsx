import { Button, Stack } from '@mui/material';
import DescriptionIcon from '@mui/icons-material/Description';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import { syllabusUrl } from '../api';

// "View syllabus", plus "PDF" for syllabi that were posted as web pages:
// the scraper prints those to PDF so every syllabus can be saved as one.
export default function SyllabusButtons({ offering }) {
  return (
    <Stack direction="row" spacing={1}>
      <Button
        variant="contained"
        startIcon={<DescriptionIcon />}
        href={syllabusUrl(offering.fileId)}
        target="_blank"
        rel="noopener"
      >
        View syllabus
      </Button>
      {offering.pdfFileId && (
        <Button
          variant="outlined"
          startIcon={<PictureAsPdfIcon />}
          href={syllabusUrl(offering.pdfFileId)}
          target="_blank"
          rel="noopener"
          aria-label="Download as PDF"
        >
          PDF
        </Button>
      )}
    </Stack>
  );
}
