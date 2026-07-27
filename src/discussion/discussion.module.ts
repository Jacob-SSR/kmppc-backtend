import { Module } from '@nestjs/common';
import { DiscussionController } from './discussion.controller';
import { DiscussionService } from './discussion.service';
import { AiSearchModule } from '../ai-search/ai-search.module';
import { UploadModule } from '../upload/upload.module';
import { SettingModule } from '../setting/setting.module';

@Module({
  imports: [AiSearchModule, UploadModule, SettingModule],
  controllers: [DiscussionController],
  providers: [DiscussionService],
})
export class DiscussionModule {}
