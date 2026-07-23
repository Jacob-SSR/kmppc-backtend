import { Module } from '@nestjs/common';
import { ArticleController } from './article.controller';
import { ArticleService } from './article.service';
import { AiSearchModule } from '../ai-search/ai-search.module';
import { UploadModule } from '../upload/upload.module';

@Module({
  imports: [AiSearchModule, UploadModule],
  controllers: [ArticleController],
  providers: [ArticleService],
})
export class ArticleModule {}
