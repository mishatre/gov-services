export type BasicResponse<R> =
    | {
          errorInfo: {
              code: number;
              message: string;
          };
      }
    | R;

export type BasicResponseWithNoData<R> =
    | {
          noData: true;
      }
    | BasicResponse<R>;

export type ExcludeErrorInfo<T> = Exclude<T, { errorInfo: any }>;
export type ExcludeNoData<T> = Exclude<T, { noData: any }>;

// elact-docs requests

type PacketSigningAuthorityType =
    | {
          ЮЛ: {
              attributes: {
                  Должн: string;
                  ИННЮЛ: string;
                  ИныеСвед: string;
              };
              ФИО: {
                  Фамилия: string;
                  Имя: string;
                  Отчество: string;
              };
          };
      }
    | {
          ИП: {
              attributes: {
                  СвГосРегИП: string;
                  ИННФЛ: string;
                  ИныеСвед: string;
              };
              ФИО: {
                  Фамилия: string;
                  Имя: string;
                  Отчество: string;
              };
          };
      }
    | {
          ФЛ: {
              attributes: {
                  ИННФЛ: string;
                  ИныеСвед: string;
              };
              ФИО: {
                  Фамилия: string;
                  Имя: string;
                  Отчество: string;
              };
          };
      };

type PacketSigningInfo = {
    attributes: {
        ВремПодписан: string;
        ДатаПодписан: string;
        ОблПолн: string;
        ОснПолн: string;
        Статус: string;
    };
    Подпись: string;
} & PacketSigningAuthorityType;

type AttachmentContent =
    | { Ссылк: string }
    | {
          ОтносКонтента: {
              КонтентИд: string;
              ТипФХ: 'ЛКП' | 'РК';
          };
      }
    | { Контент: string };

export interface FilePacket {
    attributes: {
        ИдТрПакет: string;
        СистОтпр?: string;
        СистПол?: string;
        ВнешИд?: string;
        ИдФайл: string;
        ИдПрилож?: string;
        РеестрНомКонт?: string;
        ДатаВрФормир: string;
        ТипПрилож: string;
        ВерсФорм: string;
        ИдОтпр: string;
        ИдПол: string;
    };
    Документ?: {
        attributes: {
            ДокументИд: string;
        };
        Контент: string;
        ПодписьДокумент: PacketSigningInfo | PacketSigningInfo[];
    };
    Прилож?: {
        attributes: {
            ДокументИд: string;
        };
        Контент: string;
        ПодписьПрилож: PacketSigningInfo | PacketSigningInfo[];
    };
    Вложен?: ({
        attributes: {
            КонтентИд?: string;
            ВнешКонтентИд?: string;
            ИмяФайл: string;
            РазмерФайл?: string;
            Ссылка?: string;
        };
        ПодписьВлож: PacketSigningInfo | PacketSigningInfo[];
    } & AttachmentContent)[];
    ПечатнФорм?: { Ссылка: string } | { Контент: string };
}
